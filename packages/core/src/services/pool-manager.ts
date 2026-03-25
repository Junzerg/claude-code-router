import {
  CodingPlanAccount,
  AccountPoolConfig,
  AccountStatus,
  PoolStatusSummary,
  ConcurrencyState,
  UsageState,
} from '../types/pool';
import { UsageTracker } from './usage-tracker';
import { 
  POOL_DEFAULT_MAX_CONCURRENCY,
  POOL_DEFAULT_BUFFER_RATIO,
  POOL_DEFAULT_LAST_5_HOURS_LIMIT,
  POOL_DEFAULT_WEEKLY_LIMIT
} from '@CCR/shared';

/**
 * Generate unique account ID
 * @returns Unique account identifier
 */
function generateAccountId(): string {
  return `cp-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
}

/**
 * Callback type for save notification
 */
export type SaveCallback = () => void;

/**
 * Pool Manager
 *
 * Manages Coding Plan account pool with CRUD operations and status management.
 *
 * Features:
 * - Account CRUD operations (add, remove, update, get)
 * - Account status management
 * - In-memory storage
 * - Availability checking with buffer ratios
 * - Local usage tracking via UsageTracker
 * - Optional save callback for persistence
 */
export class PoolManager {
  private accounts: Map<string, CodingPlanAccount>;
  private config: AccountPoolConfig;
  private usageTracker: UsageTracker;
  private onSave?: SaveCallback;

  /**
   * Create PoolManager instance
   * @param config - Optional partial pool configuration
   * @param onSave - Optional callback to invoke when configuration changes
   */
  constructor(config?: Partial<AccountPoolConfig>, onSave?: SaveCallback) {
    this.accounts = new Map();
    this.config = {
      enabled: config?.enabled ?? true,
      accounts: [],
      sessionBindings: new Map(),
      defaultMaxConcurrency: config?.defaultMaxConcurrency ?? POOL_DEFAULT_MAX_CONCURRENCY,
      bufferRatio: config?.bufferRatio ?? POOL_DEFAULT_BUFFER_RATIO,
      sessionBinding: {
        enabled: config?.sessionBinding?.enabled ?? true,
        ttlMinutes: config?.sessionBinding?.ttlMinutes ?? 60,
        breakOnLimited: config?.sessionBinding?.breakOnLimited ?? true,
      },
      errorRecovery: {
        maxRetries: config?.errorRecovery?.maxRetries ?? 3,
        retryDelayMs: config?.errorRecovery?.retryDelayMs ?? 1000,
      },
      usageSync: {
        enabled: config?.usageSync?.enabled ?? true,
        intervalMinutes: config?.usageSync?.intervalMinutes ?? 5,
      },
      rateLimitRecovery: {
        enabled: config?.rateLimitRecovery?.enabled ?? true,
        checkIntervalMinutes: config?.rateLimitRecovery?.checkIntervalMinutes ?? 60,
        defaultRecoveryMinutes: config?.rateLimitRecovery?.defaultRecoveryMinutes ?? 60,
      },
    };

    // Initialize usage tracker
    this.usageTracker = new UsageTracker();
    this.onSave = onSave;

    // Weekly cleanup
    setInterval(() => {
      this.usageTracker.resetStats();
    }, 7 * 24 * 60 * 60 * 1000);
  }

  /**
   * Trigger save callback if configured
   */
  private triggerSave(): void {
    if (this.onSave) {
      this.onSave();
    }
  }

  /**
   * Add a new account to the pool
   * @param accountData - Account data without auto-generated fields
   * @returns The created account with all fields populated
   */
  addAccount(
    accountData: {
      name: string;
      platform: 'zai' | 'zhipu';
      apiKey: string;
      apiBaseUrl: string;
      maxConcurrency?: number;
      last5HoursLimit?: number;
      weeklyLimit?: number;
      bufferRatio?: number;
    }
  ): CodingPlanAccount {
    const now = new Date();
    const id = generateAccountId();

    const maxConcurrency =
      accountData.maxConcurrency ?? this.config.defaultMaxConcurrency;
    const bufferRatio = accountData.bufferRatio ?? this.config.bufferRatio;
    const last5HoursLimit = accountData.last5HoursLimit ?? POOL_DEFAULT_LAST_5_HOURS_LIMIT;
    const weeklyLimit = accountData.weeklyLimit ?? POOL_DEFAULT_WEEKLY_LIMIT;

    const account: CodingPlanAccount = {
      id,
      name: accountData.name,
      platform: accountData.platform,
      apiKey: accountData.apiKey,
      apiBaseUrl: accountData.apiBaseUrl,
      status: 'active',
      concurrency: {
        current: 0,
        max: maxConcurrency,
        lastUpdated: now,
      },
      usage: {
        last5Hours: 0,
        weekly: 0,
        last5HoursLimit,
        weeklyLimit,
        lastSyncedAt: now,
      },
      config: {
        maxConcurrency,
        last5HoursLimit,
        weeklyLimit,
        bufferRatio,
      },
      metadata: {
        createdAt: now,
        updatedAt: now,
        lastUsedAt: undefined,
      },
    };

    this.accounts.set(id, account);
    console.log(`[PoolManager] Account added: ${account.name} (${id})`);
    this.triggerSave();
    return account;
  }

  /**
   * Remove an account from the pool
   * @param accountId - Account ID to remove
   * @returns True if removed, false if not found
   */
  removeAccount(accountId: string): boolean {
    const account = this.accounts.get(accountId);
    if (account) {
      this.accounts.delete(accountId);
      console.log(`[PoolManager] Account removed: ${account.name} (${accountId})`);
      this.triggerSave();
      return true;
    }
    console.warn(`[PoolManager] Account not found: ${accountId}`);
    return false;
  }

  /**
   * Get all accounts with updated usage stats from local tracker
   * @returns Array of all accounts
   */
  getAllAccounts(): CodingPlanAccount[] {
    const accounts = Array.from(this.accounts.values());

    // Update usage stats from local tracker for each account
    for (const account of accounts) {
      const trackerStats = this.usageTracker.getStats(account.id);
      if (trackerStats) {
        account.usage.last5Hours = trackerStats.last5Hours;
        account.usage.weekly = trackerStats.weekly;
        account.usage.lastUpdated = trackerStats.lastUpdated;
      }
    }

    return accounts;
  }

  /**
   * Get available accounts (active, under limits, has concurrency slots)
   * @returns Array of available accounts
   */
  getAvailableAccounts(): CodingPlanAccount[] {
    return this.getAllAccounts().filter((account) =>
      this.isAccountAvailable(account)
    );
  }

  /**
   * Update account information
   * @param accountId - Account ID to update
   * @param updates - Partial account updates
   * @returns Updated account
   * @throws Error if account not found
   */
  updateAccount(
    accountId: string,
    updates: Partial<CodingPlanAccount>
  ): CodingPlanAccount {
    const account = this.accounts.get(accountId);
    if (!account) {
      throw new Error(`Account not found: ${accountId}`);
    }

    // Update allowed fields
    const allowedFields: (keyof CodingPlanAccount)[] = [
      'name',
      'apiBaseUrl',
      'status',
      'config',
      'limitedInfo',
    ];

    for (const key of allowedFields) {
      if (updates[key] !== undefined) {
        (account as any)[key] = updates[key];
      }
    }

    // Update metadata
    account.metadata.updatedAt = new Date();

    console.log(`[PoolManager] Account updated: ${account.name} (${accountId})`);
    this.triggerSave();
    return account;
  }

  /**
   * Check if an account is available for use
   * @param account - Account to check
   * @returns True if available, false otherwise
   */
  isAccountAvailable(account: CodingPlanAccount): boolean {
    // Check account status
    if (account.status !== 'active') {
      return false;
    }

    // Check concurrency slots
    if (account.concurrency.current >= account.concurrency.max) {
      return false;
    }

    // Check 5-hour usage with buffer
    const bufferRatio = account.config.bufferRatio || this.config.bufferRatio;
    const usageRatio = account.usage.last5Hours / account.config.last5HoursLimit;
    if (usageRatio > 1 - bufferRatio) {
      return false;
    }

    // Check weekly usage with buffer
    const weeklyRatio = account.usage.weekly / account.config.weeklyLimit;
    if (weeklyRatio > 1 - bufferRatio) {
      return false;
    }

    return true;
  }

  /**
   * Check if an account is available by ID
   * @param accountId - Account ID
   * @returns True if available, false otherwise
   */
  isAccountAvailableById(accountId: string): boolean {
    const account = this.accounts.get(accountId);
    if (!account) {
      return false;
    }
    return this.isAccountAvailable(account);
  }

  /**
   * Set account status
   * @param accountId - Account ID
   * @param status - New status
   * @returns Updated account
   * @throws Error if account not found
   */
  setAccountStatus(
    accountId: string,
    status: AccountStatus
  ): CodingPlanAccount {
    const account = this.accounts.get(accountId);
    if (!account) {
      throw new Error(`Account not found: ${accountId}`);
    }

    account.status = status;
    account.metadata.updatedAt = new Date();

    console.log(
      `[PoolManager] Account ${account.name} status changed to: ${status}`
    );
    this.triggerSave();
    return account;
  }

  /**
   * Mark account as limited
   * @param accountId - Account ID
   * @param reason - Limit reason
   * @param errorMessage - Optional error message
   * @returns Updated account
   */
  markAccountLimited(
    accountId: string,
    reason: 'rate_limit' | 'quota_exhausted' | 'error' | 'manual',
    errorMessage?: string
  ): CodingPlanAccount {
    const account = this.accounts.get(accountId);
    if (!account) {
      throw new Error(`Account not found: ${accountId}`);
    }

    account.status = 'limited';
    account.limitedInfo = {
      since: new Date(),
      reason,
      errorMessage,
    };
    account.metadata.updatedAt = new Date();

    console.log(
      `[PoolManager] Account ${account.name} marked as limited: ${reason}`
    );
    this.triggerSave();
    return account;
  }

  /**
   * Recover account from limited status
   * @param accountId - Account ID
   * @returns Updated account
   */
  recoverAccount(accountId: string): CodingPlanAccount {
    const account = this.accounts.get(accountId);
    if (!account) {
      throw new Error(`Account not found: ${accountId}`);
    }

    account.status = 'active';
    account.limitedInfo = undefined;
    account.metadata.updatedAt = new Date();

    console.log(`[PoolManager] Account ${account.name} recovered`);
    this.triggerSave();
    return account;
  }

  /**
   * Update account usage
   * @param accountId - Account ID
   * @param usage - Usage update
   * @returns Updated account
   */
  updateAccountUsage(
    accountId: string,
    usage: Partial<UsageState>
  ): CodingPlanAccount {
    const account = this.accounts.get(accountId);
    if (!account) {
      throw new Error(`Account not found: ${accountId}`);
    }

    account.usage = { ...account.usage, ...usage };
    account.metadata.updatedAt = new Date();
    account.metadata.lastUsedAt = new Date();

    this.triggerSave();
    return account;
  }

  /**
   * Get pool status summary
   * @returns Pool status summary
   */
  getPoolStatus(): PoolStatusSummary {
    const accounts = this.getAllAccounts();

    const total = accounts.length;
    const active = accounts.filter((a) => a.status === 'active').length;
    const limited = accounts.filter((a) => a.status === 'limited').length;
    const error = accounts.filter((a) => a.status === 'error').length;
    const disabled = accounts.filter((a) => a.status === 'disabled').length;

    const totalConcurrency = accounts.reduce(
      (sum, a) => sum + a.concurrency.max,
      0
    );
    const availableConcurrency = accounts.reduce(
      (sum, a) => sum + Math.max(0, a.concurrency.max - a.concurrency.current),
      0
    );

    const totalUsage = accounts.reduce(
      (sum, a) => sum + a.usage.last5Hours,
      0
    );
    const totalLimit = accounts.reduce(
      (sum, a) => sum + a.config.last5HoursLimit,
      0
    );
    const totalUsagePercentage = totalLimit > 0 ? totalUsage / totalLimit : 0;

    return {
      total,
      active,
      limited,
      error,
      disabled,
      totalConcurrency,
      availableConcurrency,
      totalUsagePercentage,
    };
  }

  /**
   * Export configuration for persistence
   * @returns Serializable configuration object
   */
  exportConfig(): object {
    return {
      enabled: this.config.enabled,
      defaultMaxConcurrency: this.config.defaultMaxConcurrency,
      bufferRatio: this.config.bufferRatio,
      sessionBinding: this.config.sessionBinding,
      errorRecovery: this.config.errorRecovery,
      usageSync: this.config.usageSync,
      accounts: this.getAllAccounts().map((account) => ({
        id: account.id,
        name: account.name,
        platform: account.platform,
        apiBaseUrl: account.apiBaseUrl,
        // Note: apiKey is included but should be encrypted in production
        apiKey: account.apiKey,
        provider: account.provider,
        headers: account.headers,
        config: account.config,
        metadata: account.metadata,
      })),
    };
  }

  /**
   * Import configuration
   * @param config - Configuration object to import
   */
  importConfig(config: object): void {
    const imported = config as any;

    if (imported.enabled !== undefined) {
      this.config.enabled = imported.enabled;
    }
    if (imported.defaultMaxConcurrency !== undefined) {
      this.config.defaultMaxConcurrency = imported.defaultMaxConcurrency;
    }
    if (imported.bufferRatio !== undefined) {
      this.config.bufferRatio = imported.bufferRatio;
    }
    if (imported.accounts && Array.isArray(imported.accounts)) {
      for (const acc of imported.accounts) {
        // Use existing account ID if available, otherwise generate new one
        const accountId = acc.id || generateAccountId();
        
        const account: CodingPlanAccount = {
          id: accountId,
          name: acc.name,
          platform: acc.platform || 'zai',
          apiKey: acc.apiKey,
          apiBaseUrl: acc.apiBaseUrl || 'https://api.z.ai/api/anthropic',
          provider: acc.provider,
          headers: acc.headers,
          status: acc.status || 'active',
          concurrency: {
            current: acc.concurrency?.current || 0,
            max: acc.concurrency?.max || acc.config?.maxConcurrency || this.config.defaultMaxConcurrency,
            lastUpdated: acc.concurrency?.lastUpdated ? new Date(acc.concurrency.lastUpdated) : new Date(),
          },
          usage: {
            last5Hours: acc.usage?.last5Hours || 0,
            weekly: acc.usage?.weekly || 0,
            last5HoursLimit: acc.usage?.last5HoursLimit || acc.config?.last5HoursLimit || POOL_DEFAULT_LAST_5_HOURS_LIMIT,
            weeklyLimit: acc.usage?.weeklyLimit || acc.config?.weeklyLimit || POOL_DEFAULT_WEEKLY_LIMIT,
            lastSyncedAt: acc.usage?.lastSyncedAt ? new Date(acc.usage.lastSyncedAt) : undefined,
            lastUpdated: acc.usage?.lastUpdated ? new Date(acc.usage.lastUpdated) : undefined,
          },
          config: {
            maxConcurrency: acc.config?.maxConcurrency || this.config.defaultMaxConcurrency,
            last5HoursLimit: acc.config?.last5HoursLimit || POOL_DEFAULT_LAST_5_HOURS_LIMIT,
            weeklyLimit: acc.config?.weeklyLimit || POOL_DEFAULT_WEEKLY_LIMIT,
            bufferRatio: acc.config?.bufferRatio || this.config.bufferRatio,
          },
          metadata: {
            createdAt: acc.metadata?.createdAt ? new Date(acc.metadata.createdAt) : new Date(),
            updatedAt: acc.metadata?.updatedAt ? new Date(acc.metadata.updatedAt) : new Date(),
            lastUsedAt: acc.metadata?.lastUsedAt ? new Date(acc.metadata.lastUsedAt) : undefined,
          },
        };

        this.accounts.set(accountId, account);
        console.log(`[PoolManager] Account imported: ${account.name} (${accountId})`);
      }
    }

    console.log(
      `[PoolManager] Configuration imported: ${this.accounts.size} accounts`
    );
  }

  /**
   * Get pool configuration
   * @returns Current pool configuration
   */
  getConfig(): AccountPoolConfig {
    return { ...this.config };
  }

  /**
   * Record a request for local usage tracking
   *
   * @param accountId - Account ID used
   * @param options - Request options (estimated tokens, model)
   */
  recordRequest(
    accountId: string,
    options: {
      estimatedTokens?: number;
      model?: string;
    } = {}
  ): void {
    this.usageTracker.recordRequest(accountId, options);
  }

  /**
   * Get account by ID with updated usage stats from local tracker
   *
   * @param accountId - Account ID
   * @returns Account with updated usage stats or undefined if not found
   */
  getAccount(accountId: string): CodingPlanAccount | undefined {
    const account = this.accounts.get(accountId);
    if (!account) return undefined;

    // Update usage stats from local tracker
    const last5Hours = this.usageTracker.getLast5Hours(accountId);
    const weekly = this.usageTracker.getWeekly(accountId);

    // Use local tracker data if it's more recent than API data
    const trackerStats = this.usageTracker.getStats(accountId);
    if (trackerStats) {
      account.usage.last5Hours = last5Hours;
      account.usage.weekly = weekly;
      account.usage.lastUpdated = trackerStats.lastUpdated;
    }

    return account;
  }

  /**
   * Get usage tracker instance
   *
   * @returns UsageTracker instance
   */
  getUsageTracker(): UsageTracker {
    return this.usageTracker;
  }
}
