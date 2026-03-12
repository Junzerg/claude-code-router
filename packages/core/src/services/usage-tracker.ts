import { AccountUsageStats } from '../types/pool';

/**
 * Usage tracking options
 */
export interface UsageTrackerOptions {
  /** Default token estimate per request (default: 1000) */
  defaultTokens?: number;
  /** Whether to enable verbose logging */
  verbose?: boolean;
}

/**
 * Local Usage Tracker
 *
 * Tracks request counts and token usage locally as a supplement
 * to Z.ai API usage data. Useful when API has rate limits or
 * doesn't provide real-time data.
 *
 * Features:
 * - Per-account request counting
 * - Token usage estimation
 * - 5-hour rolling window statistics
 * - Weekly statistics
 * - Automatic cleanup of expired data
 *
 * Usage:
 * ```typescript
 * const tracker = new UsageTracker();
 *
 * // Record a request
 * tracker.recordRequest('account-123', {
 *   estimatedTokens: 2500,
 *   model: 'claude-sonnet',
 * });
 *
 * // Get statistics
 * const last5Hours = tracker.getLast5Hours('account-123');
 * const weekly = tracker.getWeekly('account-123');
 * const stats = tracker.getStats('account-123');
 * ```
 */
export class UsageTracker {
  private stats: Map<string, AccountUsageStats>;
  private options: Required<UsageTrackerOptions>;
  private cleanupInterval?: NodeJS.Timeout;

  /**
   * Create UsageTracker instance
   * @param options - Tracker configuration
   */
  constructor(options?: UsageTrackerOptions) {
    this.stats = new Map();
    this.options = {
      defaultTokens: options?.defaultTokens ?? 1000,
      verbose: options?.verbose ?? false,
    };

    // Start automatic cleanup every hour
    this.startCleanup();
    this.log('UsageTracker initialized');
  }

  /**
   * Record a request for an account
   *
   * @param accountId - Account ID
   * @param options - Request options (tokens, model)
   */
  recordRequest(
    accountId: string,
    options: {
      estimatedTokens?: number;
      model?: string;
    } = {}
  ): void {
    let accountStats = this.stats.get(accountId);

    if (!accountStats) {
      accountStats = {
        requests: new Map(),
        last5Hours: 0,
        weekly: 0,
        lastUpdated: new Date(),
      };
      this.stats.set(accountId, accountStats);
      this.log(`Created stats for account: ${accountId}`);
    }

    const now = Date.now();
    const tokens = options.estimatedTokens ?? this.options.defaultTokens;

    // Record request with timestamp
    accountStats.requests.set(now, tokens);
    this.log(
      `Recorded request for ${accountId}: ${tokens} tokens (model: ${options.model || 'unknown'})`
    );

    // Update counts
    this.updateCounts(accountStats);
  }

  /**
   * Get usage statistics for an account
   *
   * @param accountId - Account ID
   * @returns Account usage statistics or undefined
   */
  getStats(accountId: string): AccountUsageStats | undefined {
    return this.stats.get(accountId);
  }

  /**
   * Get request count for last 5 hours
   *
   * @param accountId - Account ID
   * @returns Token count in last 5 hours
   */
  getLast5Hours(accountId: string): number {
    const stats = this.stats.get(accountId);
    return stats?.last5Hours ?? 0;
  }

  /**
   * Get request count for current week
   *
   * @param accountId - Account ID
   * @returns Token count in current week
   */
  getWeekly(accountId: string): number {
    const stats = this.stats.get(accountId);
    return stats?.weekly ?? 0;
  }

  /**
   * Get all account IDs being tracked
   *
   * @returns Array of account IDs
   */
  getTrackedAccounts(): string[] {
    return Array.from(this.stats.keys());
  }

  /**
   * Get total usage across all accounts
   *
   * @returns Total usage statistics
   */
  getTotalUsage(): {
    totalLast5Hours: number;
    totalWeekly: number;
    accountCount: number;
  } {
    let totalLast5Hours = 0;
    let totalWeekly = 0;

    for (const stats of this.stats.values()) {
      totalLast5Hours += stats.last5Hours;
      totalWeekly += stats.weekly;
    }

    return {
      totalLast5Hours,
      totalWeekly,
      accountCount: this.stats.size,
    };
  }

  /**
   * Clear statistics for an account
   *
   * @param accountId - Account ID
   */
  clearAccount(accountId: string): void {
    this.stats.delete(accountId);
    this.log(`Cleared stats for account: ${accountId}`);
  }

  /**
   * Clear all statistics
   */
  clearAll(): void {
    this.stats.clear();
    this.log('Cleared all stats');
  }

  /**
   * Reset statistics (cleanup old data)
   *
   * Called periodically to remove data older than one week.
   */
  resetStats(): void {
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

    for (const stats of this.stats.values()) {
      // Remove data older than one week
      for (const timestamp of stats.requests.keys()) {
        if (timestamp <= weekAgo) {
          stats.requests.delete(timestamp);
        }
      }
      this.updateCounts(stats);
    }

    this.log('Reset stats: removed data older than 1 week');
  }

  /**
   * Start automatic cleanup
   *
   * @param intervalMs - Cleanup interval (default: 1 hour)
   */
  startCleanup(intervalMs: number = 60 * 60 * 1000): void {
    this.stopCleanup();

    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredData();
    }, intervalMs);

    this.log(`Started cleanup interval (every ${intervalMs / 60000} min)`);
  }

  /**
   * Stop automatic cleanup
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
      this.log('Stopped cleanup interval');
    }
  }

  /**
   * Get tracker statistics
   */
  getTrackerStats(): {
    trackedAccounts: number;
    totalRequests: number;
    isCleanupRunning: boolean;
  } {
    let totalRequests = 0;
    for (const stats of this.stats.values()) {
      totalRequests += stats.requests.size;
    }

    return {
      trackedAccounts: this.stats.size,
      totalRequests,
      isCleanupRunning: this.cleanupInterval !== undefined,
    };
  }

  /**
   * Clean up expired data (called internally)
   */
  private cleanupExpiredData(): void {
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    let cleanedCount = 0;

    for (const [accountId, stats] of this.stats.entries()) {
      let removed = 0;

      // Remove data older than one week
      for (const timestamp of stats.requests.keys()) {
        if (timestamp <= weekAgo) {
          stats.requests.delete(timestamp);
          removed++;
          cleanedCount++;
        }
      }

      if (removed > 0) {
        this.updateCounts(stats);
        this.log(
          `Cleaned up ${removed} expired records for account ${accountId}`
        );
      }

      // Remove empty stats
      if (stats.requests.size === 0) {
        this.stats.delete(accountId);
        this.log(`Removed empty stats for account ${accountId}`);
      }
    }

    if (cleanedCount > 0) {
      this.log(`Cleanup removed ${cleanedCount} total expired records`);
    }
  }

  /**
   * Update count calculations
   *
   * @param stats - Account stats to update
   */
  private updateCounts(stats: AccountUsageStats): void {
    const now = Date.now();
    const fiveHoursAgo = now - 5 * 60 * 60 * 1000;
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

    let last5Hours = 0;
    let weekly = 0;

    // Iterate and sum up tokens
    for (const [timestamp, tokens] of stats.requests.entries()) {
      if (timestamp > fiveHoursAgo) {
        last5Hours += tokens;
      }
      if (timestamp > weekAgo) {
        weekly += tokens;
      }
    }

    stats.last5Hours = last5Hours;
    stats.weekly = weekly;
    stats.lastUpdated = new Date();
  }

  /**
   * Log message if verbose mode is enabled
   */
  private log(message: string): void {
    if (this.options.verbose) {
      console.log(`[UsageTracker] ${message}`);
    } else {
      console.log(`[UsageTracker] ${message}`);
    }
  }
}
