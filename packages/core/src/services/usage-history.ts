import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { CodingPlanAccount } from '../types/pool';
import { homedir } from 'os';

/**
 * Usage history record structure
 */
export interface UsageHistoryRecord {
  accountId: string;
  accountName: string;
  timestamp: Date;
  last5Hours: number;
  weekly: number;
  last5HoursPercentage: number;
  weeklyPercentage: number;
  requestsCount: number;
}

/**
 * Usage trend data point
 */
export interface TrendDataPoint {
  timestamp: string;
  value: number;
  percentage?: number;
}

/**
 * Usage history service configuration
 */
export interface UsageHistoryConfig {
  /** Storage path (default: ~/.claude-code-router/usage-history.json) */
  storagePath?: string;
  /** Maximum records to keep per account (default: 288 = 24 hours at 5-min intervals) */
  maxRecordsPerAccount?: number;
  /** Auto-cleanup interval in hours (default: 24) */
  cleanupIntervalHours?: number;
  /** Enable verbose logging */
  verbose?: boolean;
}

/**
 * Query options for history retrieval
 */
export interface HistoryQueryOptions {
  startTime?: Date;
  endTime?: Date;
  limit?: number;
}

/**
 * Historical Usage Statistics Service
 *
 * Records and manages historical usage data for pool accounts.
 * Supports trend analysis and reporting.
 *
 * Features:
 * - Automatic snapshot recording
 * - Historical data queries
 * - Usage trend analysis
 * - Automatic cleanup of old data
 * - Persistent storage
 *
 * Usage:
 * ```typescript
 * const usageHistory = new UsageHistoryService(poolManager, {
 *   maxRecordsPerAccount: 288,
 * });
 *
 * // Start automatic snapshots (every 5 minutes)
 * usageHistory.start();
 *
 * // Get account history
 * const history = usageHistory.getHistory('account-id', { limit: 24 });
 *
 * // Get usage trend
 * const trend = usageHistory.getTrend('account-id', 24);
 *
 * // Stop when done
 * usageHistory.stop();
 * ```
 */
export class UsageHistoryService {
  private history: Map<string, UsageHistoryRecord[]>;
  private config: UsageHistoryConfig;
  private snapshotInterval?: NodeJS.Timeout;
  private cleanupInterval?: NodeJS.Timeout;
  private getAccount?: (accountId: string) => CodingPlanAccount | undefined;

  /**
   * Create UsageHistoryService instance
   * @param getAccount - Function to get account by ID
   * @param config - Service configuration
   */
  constructor(
    getAccount: (accountId: string) => CodingPlanAccount | undefined,
    config?: UsageHistoryConfig
  ) {
    this.history = new Map();
    this.config = {
      storagePath: config?.storagePath || join(homedir(), '.claude-code-router', 'usage-history.json'),
      maxRecordsPerAccount: config?.maxRecordsPerAccount || 288,
      cleanupIntervalHours: config?.cleanupIntervalHours || 24,
      verbose: config?.verbose || false,
    };
    this.getAccount = getAccount;

    this.log('UsageHistoryService initialized');
  }

  /**
   * Initialize storage and load existing data
   */
  async initialize(): Promise<boolean> {
    try {
      await this.load();
      this.log('Historical data loaded successfully');
      return true;
    } catch (error: any) {
      this.log(`Failed to load historical data: ${error.message}`);
      return false;
    }
  }

  /**
   * Start automatic snapshot recording
   * @param intervalMinutes - Snapshot interval (default: 5 minutes)
   */
  start(intervalMinutes: number = 5): void {
    if (this.snapshotInterval) {
      this.log('Snapshot recording already running, ignoring start() call');
      return;
    }

    const intervalMs = intervalMinutes * 60 * 1000;

    this.log(`Starting automatic snapshot recording (interval: ${intervalMinutes}m)`);

    // Initial snapshot
    this.recordAllSnapshots();

    // Start periodic snapshots
    this.snapshotInterval = setInterval(() => {
      this.recordAllSnapshots();
    }, intervalMs);

    // Start auto-cleanup
    this.startCleanup();

    this.log('Automatic snapshot recording started');
  }

  /**
   * Stop automatic snapshot recording
   */
  stop(): void {
    if (this.snapshotInterval) {
      clearInterval(this.snapshotInterval);
      this.snapshotInterval = undefined;
      this.log('Snapshot recording stopped');
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
      this.log('Auto-cleanup stopped');
    }
  }

  /**
   * Check if recording is running
   */
  isRunning(): boolean {
    return this.snapshotInterval !== undefined;
  }

  /**
   * Record usage snapshot for a single account
   * @param account - Account to record
   */
  recordSnapshot(account: CodingPlanAccount): void {
    const usageRatio5h = account.config.last5HoursLimit > 0
      ? account.usage.last5Hours / account.config.last5HoursLimit
      : 0;
    const usageRatioWeekly = account.config.weeklyLimit > 0
      ? account.usage.weekly / account.config.weeklyLimit
      : 0;

    const record: UsageHistoryRecord = {
      accountId: account.id,
      accountName: account.name,
      timestamp: new Date(),
      last5Hours: account.usage.last5Hours,
      weekly: account.usage.weekly,
      last5HoursPercentage: usageRatio5h,
      weeklyPercentage: usageRatioWeekly,
      requestsCount: account.stats?.totalRequests || 0,
    };

    // Get or create history array for this account
    let accountHistory = this.history.get(account.id);
    if (!accountHistory) {
      accountHistory = [];
      this.history.set(account.id, accountHistory);
    }

    // Add new record
    accountHistory.push(record);

    // Trim to max records
    while (accountHistory.length > this.config.maxRecordsPerAccount!) {
      accountHistory.shift();
    }

    this.log(`Recorded snapshot for ${account.name}: 5h=${(usageRatio5h * 100).toFixed(1)}%, weekly=${(usageRatioWeekly * 100).toFixed(1)}%`);
  }

  /**
   * Record snapshots for all available accounts
   */
  recordAllSnapshots(): void {
    if (!this.getAccount) {
      this.log('getAccount function not set, cannot record snapshots');
      return;
    }

    // Get all account IDs from history to record for
    const accountIds = new Set(this.history.keys());

    // Also get currently available accounts
    // Note: We need to iterate through potential accounts
    // This is a limitation - we record for accounts we have history for
    // plus any new accounts that get added

    for (const accountId of accountIds) {
      const account = this.getAccount(accountId);
      if (account) {
        this.recordSnapshot(account);
      }
    }

    this.log(`Recorded snapshots for ${accountIds.size} accounts`);
  }

  /**
   * Get usage history for an account
   * @param accountId - Account ID
   * @param options - Query options
   * @returns Usage history records
   */
  getHistory(accountId: string, options?: HistoryQueryOptions): UsageHistoryRecord[] {
    const accountHistory = this.history.get(accountId) || [];

    if (!options) {
      return [...accountHistory];
    }

    let filtered = [...accountHistory];

    if (options.startTime) {
      filtered = filtered.filter((r) => new Date(r.timestamp) >= options.startTime!);
    }

    if (options.endTime) {
      filtered = filtered.filter((r) => new Date(r.timestamp) <= options.endTime!);
    }

    if (options.limit) {
      filtered = filtered.slice(-options.limit);
    }

    return filtered;
  }

  /**
   * Get usage trend for an account
   * @param accountId - Account ID
   * @param hours - Number of hours to analyze
   * @param metric - Metric to track ('5h' or 'weekly')
   * @returns Trend data points
   */
  getTrend(
    accountId: string,
    hours: number,
    metric: '5h' | 'weekly' = '5h'
  ): TrendDataPoint[] {
    const history = this.getHistory(accountId, { limit: hours * 12 }); // Assuming 5-min intervals
    const cutoffTime = Date.now() - hours * 60 * 60 * 1000;

    return history
      .filter((r) => new Date(r.timestamp).getTime() >= cutoffTime)
      .map((r) => ({
        timestamp: new Date(r.timestamp).toISOString(),
        value: metric === '5h' ? r.last5Hours : r.weekly,
        percentage: metric === '5h' ? r.last5HoursPercentage : r.weeklyPercentage,
      }));
  }

  /**
   * Get usage statistics summary
   * @param accountId - Account ID (optional, returns all accounts summary if not provided)
   * @returns Usage statistics
   */
  getStats(accountId?: string): {
    accountId?: string;
    accountName?: string;
    recordCount: number;
    firstRecord?: Date;
    lastRecord?: Date;
    avgUsage5h?: number;
    avgUsageWeekly?: number;
    peakUsage5h?: number;
    peakUsageWeekly?: number;
  } {
    if (accountId) {
      const history = this.history.get(accountId) || [];

      if (history.length === 0) {
        return {
          recordCount: 0,
        };
      }

      const usage5hValues = history.map((r) => r.last5HoursPercentage);
      const usageWeeklyValues = history.map((r) => r.weeklyPercentage);

      return {
        accountId,
        accountName: history[0]?.accountName,
        recordCount: history.length,
        firstRecord: history[0]?.timestamp,
        lastRecord: history[history.length - 1]?.timestamp,
        avgUsage5h: this.average(usage5hValues),
        avgUsageWeekly: this.average(usageWeeklyValues),
        peakUsage5h: Math.max(...usage5hValues),
        peakUsageWeekly: Math.max(...usageWeeklyValues),
      };
    }

    // Summary for all accounts
    const allRecordCounts = Array.from(this.history.values()).map((h) => h.length);
    const totalRecords = allRecordCounts.reduce((a, b) => a + b, 0);

    return {
      recordCount: totalRecords,
    };
  }

  /**
   * Get all account IDs with history
   */
  getAccountIds(): string[] {
    return Array.from(this.history.keys());
  }

  /**
   * Clear history for an account
   * @param accountId - Account ID
   */
  clearHistory(accountId: string): void {
    this.history.delete(accountId);
    this.log(`Cleared history for account ${accountId}`);
  }

  /**
   * Clear all history
   */
  clearAllHistory(): void {
    this.history.clear();
    this.log('Cleared all history');
  }

  /**
   * Cleanup old data
   * @param olderThanDays - Remove records older than this many days
   */
  cleanup(olderThanDays: number = 7): void {
    const cutoffTime = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    let removedCount = 0;

    for (const [accountId, records] of this.history.entries()) {
      const before = records.length;
      const filtered = records.filter(
        (r) => new Date(r.timestamp).getTime() >= cutoffTime
      );

      removedCount += before - filtered.length;

      if (filtered.length === 0) {
        this.history.delete(accountId);
      } else {
        this.history.set(accountId, filtered);
      }
    }

    this.log(`Cleanup completed: removed ${removedCount} records older than ${olderThanDays} days`);
  }

  /**
   * Save history to file
   */
  async save(): Promise<boolean> {
    try {
      // Convert Map to serializable format
      const data: Record<string, UsageHistoryRecord[]> = {};
      for (const [accountId, records] of this.history.entries()) {
        data[accountId] = records.map((r) => ({
          ...r,
          timestamp: new Date(r.timestamp).toISOString(),
        }));
      }

      const content = JSON.stringify(data, null, 2);
      await writeFile(this.config.storagePath!, content, 'utf-8');

      this.log(`Saved ${this.history.size} account histories to ${this.config.storagePath}`);
      return true;
    } catch (error: any) {
      this.log(`Failed to save history: ${error.message}`);
      return false;
    }
  }

  /**
   * Load history from file
   */
  async load(): Promise<boolean> {
    try {
      const content = await readFile(this.config.storagePath!, 'utf-8');
      const data: Record<string, UsageHistoryRecord[]> = JSON.parse(content);

      this.history.clear();

      for (const [accountId, records] of Object.entries(data)) {
        const parsedRecords = records.map((r) => ({
          ...r,
          timestamp: new Date(r.timestamp),
        }));
        this.history.set(accountId, parsedRecords);
      }

      this.log(`Loaded ${this.history.size} account histories from ${this.config.storagePath}`);
      return true;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        this.log('No existing history file found, starting fresh');
      } else {
        this.log(`Failed to load history: ${error.message}`);
      }
      return false;
    }
  }

  /**
   * Start automatic cleanup
   */
  private startCleanup(): void {
    if (this.cleanupInterval) {
      return;
    }

    const intervalMs = this.config.cleanupIntervalHours! * 60 * 60 * 1000;

    this.cleanupInterval = setInterval(() => {
      this.log('Running scheduled cleanup...');
      this.cleanup(7); // Default: cleanup records older than 7 days
      this.save().catch((err) => {
        this.log(`Failed to save after cleanup: ${err.message}`);
      });
    }, intervalMs);

    this.log(`Auto-cleanup scheduled (interval: ${this.config.cleanupIntervalHours}h)`);
  }

  /**
   * Calculate average of an array
   */
  private average(arr: number[]): number {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  /**
   * Calculate growth rate from history
   */
  calculateGrowthRate(history: UsageHistoryRecord[]): number {
    if (history.length < 2) return 0;

    const recent = history[history.length - 1].last5HoursPercentage;
    const older = history[0].last5HoursPercentage;
    const hoursDiff = (new Date(history[history.length - 1].timestamp).getTime() -
                       new Date(history[0].timestamp).getTime()) / (60 * 60 * 1000);

    if (hoursDiff <= 0) return 0;

    return (recent - older) / hoursDiff;
  }

  /**
   * Predict exhaustion time for an account
   * @param accountId - Account ID
   * @returns Predicted exhaustion time or null if insufficient data
   */
  predictExhaustionTime(accountId: string): Date | null {
    const history = this.getHistory(accountId, { limit: 12 }); // Last ~1 hour at 5-min intervals

    if (history.length < 2) return null;

    const growthRate = this.calculateGrowthRate(history);
    if (growthRate <= 0) return null; // Usage not increasing

    const currentUsage = history[history.length - 1].last5HoursPercentage;
    const remainingCapacity = 1 - currentUsage;

    if (remainingCapacity <= 0) return new Date(); // Already exhausted

    const hoursUntilExhaustion = remainingCapacity / growthRate;

    return new Date(Date.now() + hoursUntilExhaustion * 60 * 60 * 1000);
  }

  /**
   * Log message if verbose mode is enabled
   */
  private log(message: string): void {
    if (this.config.verbose) {
      console.log(`[UsageHistory] ${message}`);
    }
  }
}

/**
 * Create and initialize UsageHistoryService
 * @param getAccount - Function to get account by ID
 * @param config - Service configuration
 * @returns UsageHistoryService instance
 */
export function createUsageHistoryService(
  getAccount: (accountId: string) => CodingPlanAccount | undefined,
  config?: UsageHistoryConfig
): UsageHistoryService {
  const service = new UsageHistoryService(getAccount, config);
  service.initialize().catch((err) => {
    console.warn(`[UsageHistory] Initialization failed: ${err.message}`);
  });
  return service;
}
