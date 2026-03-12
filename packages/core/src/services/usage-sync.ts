import { PoolManager } from './pool-manager';
import { ZaiUsageClient } from '../api/zai-usage';
import { CodingPlanAccount, QuotaLimitResponse } from '../types/pool';
import { AlertService } from './alerts';
import { UsageHistoryService } from './usage-history';

/**
 * Usage Sync Service Options
 */
export interface UsageSyncOptions {
  /** Sync interval in minutes (default: 5) */
  intervalMinutes: number;
  /** Whether to enable verbose logging */
  verbose?: boolean;
}

/**
 * Usage Sync Service Callbacks
 */
export interface UsageSyncCallbacks {
  /** Called when sync starts */
  onSyncStart?: () => void;
  /** Called when sync completes */
  onSyncComplete?: (successCount: number, failCount: number) => void;
  /** Called when sync fails for an account */
  onSyncError?: (accountId: string, error: Error) => void;
  /** Called when account approaches limit */
  onApproachingLimit?: (accountId: string, percentage: number) => void;
}

/**
 * Usage Sync Service
 *
 * Periodically syncs usage data from Z.ai API to keep account pool
 * usage statistics up to date.
 *
 * Features:
 * - Automatic periodic sync (configurable interval)
 * - Per-account usage tracking
 * - Warning when approaching usage limits
 * - Error handling and retry logic
 *
 * Usage:
 * ```typescript
 * const poolManager = new PoolManager(config);
 * const usageSync = new UsageSyncService(poolManager, {
 *   intervalMinutes: 5,
 * });
 *
 * // Start automatic sync
 * usageSync.start();
 *
 * // Or manually sync
 * await usageSync.syncAccount('account-id');
 * await usageSync.syncAll();
 *
 * // Stop when done
 * usageSync.stop();
 * ```
 */
export class UsageSyncService {
  private poolManager: PoolManager;
  private options: UsageSyncOptions;
  private syncIntervalMs: number;
  private syncTimer?: NodeJS.Timeout;
  private clients: Map<string, ZaiUsageClient>;
  private callbacks?: UsageSyncCallbacks;
  private lastSyncTime?: Date;
  private syncRunning: boolean = false;
  private alertService?: AlertService;
  private usageHistory?: UsageHistoryService;

  /**
   * Create UsageSyncService instance
   * @param poolManager - PoolManager instance
   * @param options - Sync configuration
   * @param callbacks - Optional callback hooks
   * @param alertService - Optional AlertService instance for notifications
   * @param usageHistory - Optional UsageHistoryService instance for recording snapshots
   */
  constructor(
    poolManager: PoolManager,
    options: UsageSyncOptions,
    callbacks?: UsageSyncCallbacks,
    alertService?: AlertService,
    usageHistory?: UsageHistoryService
  ) {
    this.poolManager = poolManager;
    this.options = {
      intervalMinutes: options.intervalMinutes ?? 5,
      verbose: options.verbose ?? false,
    };
    this.syncIntervalMs = this.options.intervalMinutes * 60 * 1000;
    this.clients = new Map();
    this.callbacks = callbacks;
    this.alertService = alertService;
    this.usageHistory = usageHistory;

    this.log(
      `UsageSyncService initialized (interval: ${this.options.intervalMinutes}m)`
    );
  }

  /**
   * Start automatic sync
   *
   * Immediately syncs all accounts once, then starts periodic sync.
   */
  start(): void {
    if (this.syncTimer) {
      this.log('Sync already running, ignoring start() call');
      return;
    }

    this.log('Starting usage sync service...');
    this.callbacks?.onSyncStart?.();

    // Initial sync
    this.syncAll()
      .then(() => {
        this.log('Initial sync completed');
      })
      .catch((err) => {
        this.log(`Initial sync failed: ${err.message}`);
      });

    // Start periodic sync
    this.syncTimer = setInterval(() => {
      this.log('Starting scheduled sync...');
      this.syncAll()
        .then(() => {
          this.log('Scheduled sync completed');
        })
        .catch((err) => {
          this.log(`Scheduled sync failed: ${err.message}`);
        });
    }, this.syncIntervalMs);

    this.log(`Sync timer started (interval: ${this.options.intervalMinutes}m)`);
  }

  /**
   * Stop automatic sync
   */
  stop(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = undefined;
      this.log('Sync timer stopped');
    }
  }

  /**
   * Check if sync is running
   */
  isRunning(): boolean {
    return this.syncTimer !== undefined;
  }

  /**
   * Get last sync time
   */
  getLastSyncTime(): Date | undefined {
    return this.lastSyncTime;
  }

  /**
   * Manually sync a specific account
   *
   * @param accountId - Account ID to sync
   * @throws Error if sync fails
   */
  async syncAccount(accountId: string): Promise<void> {
    const account = this.poolManager.getAccount(accountId);
    if (!account) {
      this.log(`Account ${accountId} not found, skipping sync`);
      return;
    }

    if (account.status !== 'active') {
      this.log(
        `Account ${accountId} status is ${account.status}, skipping sync`
      );
      return;
    }

    this.log(`Syncing account ${accountId} (${account.name})...`);

    // Get or create client
    let client = this.clients.get(accountId);
    if (!client) {
      client = new ZaiUsageClient({
        apiBaseUrl: account.apiBaseUrl,
        apiKey: account.apiKey,
      });
      this.clients.set(accountId, client);
      this.log(`Created ZaiUsageClient for account ${accountId}`);
    }

    try {
      // Get quota limit
      const quotaLimit = await client.getQuotaLimit();
      this.log(
        `Account ${accountId} quota: ${JSON.stringify(quotaLimit.data.limits)}`
      );

      // Parse quota percentages
      const percentages = ZaiUsageClient.parseQuotaPercentages(quotaLimit);

      // Update account usage state
      account.usage = {
        ...account.usage,
        last5HoursPercentage: percentages.last5HoursPercentage,
        weeklyPercentage: percentages.weeklyPercentage,
        lastSyncedAt: new Date(),
        lastUpdated: new Date(),
      };

      // Check if approaching limit
      const bufferRatio = account.config.bufferRatio ?? 0.1;
      const threshold = 1 - bufferRatio;

      if (percentages.last5HoursPercentage > threshold) {
        const percentage = (percentages.last5HoursPercentage * 100).toFixed(1);
        this.log(
          `⚠️ Account ${accountId} approaching 5h limit: ${percentage}% (threshold: ${threshold * 100}%)`
        );
        this.callbacks?.onApproachingLimit?.(
          accountId,
          percentages.last5HoursPercentage
        );
      }

      if (percentages.weeklyPercentage > threshold) {
        const percentage = (percentages.weeklyPercentage * 100).toFixed(1);
        this.log(
          `⚠️ Account ${accountId} approaching weekly limit: ${percentage}% (threshold: ${threshold * 100}%)`
        );
        this.callbacks?.onApproachingLimit?.(
          accountId,
          percentages.weeklyPercentage
        );
      }

      this.log(
        `Synced account ${accountId}: 5h=${(percentages.last5HoursPercentage * 100).toFixed(1)}%, weekly=${(percentages.weeklyPercentage * 100).toFixed(1)}%`
      );

      // Record to usage history
      this.usageHistory?.recordSnapshot(account);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.log(`Failed to sync account ${accountId}: ${errorMessage}`);
      this.callbacks?.onSyncError?.(accountId, error as Error);
      throw error;
    }
  }

  /**
   * Sync all active accounts
   *
   * Syncs all active accounts in parallel with error handling.
   */
  async syncAll(): Promise<void> {
    if (this.syncRunning) {
      this.log('Sync already running, skipping concurrent execution');
      return;
    }

    this.syncRunning = true;
    const startTime = Date.now();

    try {
      const accounts = this.poolManager
        .getAvailableAccounts()
        .filter((a) => a.status === 'active');

      if (accounts.length === 0) {
        this.log('No active accounts to sync');
        return;
      }

      this.log(`Starting sync for ${accounts.length} accounts...`);
      this.callbacks?.onSyncStart?.();

      // Sync all accounts in parallel
      const results = await Promise.allSettled(
        accounts.map((account) => this.syncAccount(account.id))
      );

      const successCount = results.filter(
        (r) => r.status === 'fulfilled'
      ).length;
      const failCount = results.filter((r) => r.status === 'rejected').length;

      const duration = Date.now() - startTime;
      this.lastSyncTime = new Date();

      this.log(
        `Sync completed in ${duration}ms: ${successCount} succeeded, ${failCount} failed`
      );
      this.callbacks?.onSyncComplete?.(successCount, failCount);

      // Log failures
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          const account = accounts[index];
          this.log(
            `Failed to sync ${account.name} (${account.id}): ${result.reason}`
          );
        }
      });
    } finally {
      this.syncRunning = false;
    }
  }

  /**
   * Get sync statistics
   */
  getStats(): {
    isRunning: boolean;
    intervalMinutes: number;
    lastSyncTime?: Date;
    clientCount: number;
    syncRunning: boolean;
  } {
    return {
      isRunning: this.isRunning(),
      intervalMinutes: this.options.intervalMinutes,
      lastSyncTime: this.lastSyncTime,
      clientCount: this.clients.size,
      syncRunning: this.syncRunning,
    };
  }

  /**
   * Update sync interval
   *
   * @param intervalMinutes - New interval in minutes
   */
  setInterval(intervalMinutes: number): void {
    const wasRunning = this.isRunning();

    // Stop current timer
    this.stop();

    // Update interval
    this.options.intervalMinutes = intervalMinutes;
    this.syncIntervalMs = intervalMinutes * 60 * 1000;

    this.log(`Sync interval updated to ${intervalMinutes}m`);

    // Restart if was running
    if (wasRunning) {
      this.start();
    }
  }

  /**
   * Clear all cached clients
   */
  clearClients(): void {
    this.clients.clear();
    this.log('Cleared all ZaiUsageClient instances');
  }

  /**
   * Log message if verbose mode is enabled
   */
  private log(message: string): void {
    if (this.options.verbose) {
      console.log(`[UsageSync] ${message}`);
    } else {
      console.log(`[UsageSync] ${message}`);
    }
  }
}
