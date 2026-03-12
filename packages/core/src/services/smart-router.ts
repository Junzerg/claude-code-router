import { CodingPlanAccount } from '../types/pool';
import { UsageHistoryService } from './usage-history';
import { UsageHistoryRecord } from './usage-history';

/**
 * Account selection result
 */
export interface AccountSelectionResult {
  accountId: string;
  accountName: string;
  score: number;
  reason: string;
  predictedExhaustionTime?: Date;
}

/**
 * Smart router configuration
 */
export interface SmartRouterConfig {
  /** Weights for scoring components (default: { usage: 40, concurrency: 30, health: 30 }) */
  weights?: {
    usage: number;
    concurrency: number;
    health: number;
  };
  /** Enable usage prediction (default: true) */
  enablePrediction?: boolean;
  /** Minimum score threshold (default: 0.3) */
  minScoreThreshold?: number;
  /** Enable verbose logging */
  verbose?: boolean;
}

/**
 * Account error tracking
 */
interface ErrorTracking {
  totalRequests: number;
  totalErrors: number;
  lastErrorAt?: Date;
  consecutiveErrors: number;
}

/**
 * Smart Router
 *
 * Intelligent router that selects the best account from the pool
 * based on multiple factors:
 * - Current usage levels
 * - Concurrency availability
 * - Historical error rates
 * - Usage trend prediction
 *
 * Features:
 * - Weighted scoring algorithm
 * - Usage exhaustion prediction
 * - Load balancing across accounts
 * - Health-based filtering
 *
 * Usage:
 * ```typescript
 * const smartRouter = new SmartRouter(usageHistoryService, {
 *   weights: { usage: 40, concurrency: 30, health: 30 },
 *   enablePrediction: true,
 * });
 *
 * // Select best account
 * const selection = smartRouter.selectBestAccount(availableAccounts, 'session-id');
 *
 * // Record request outcome
 * smartRouter.recordRequest(accountId, success);
 *
 * // Get usage prediction
 * const exhaustionTime = smartRouter.predictExhaustionTime(accountId);
 * ```
 */
export class SmartRouter {
  private usageHistory: UsageHistoryService;
  private config: SmartRouterConfig;
  private errorTracking: Map<string, ErrorTracking>;

  /**
   * Create SmartRouter instance
   * @param usageHistory - UsageHistoryService instance
   * @param config - Router configuration
   */
  constructor(
    usageHistory: UsageHistoryService,
    config?: SmartRouterConfig
  ) {
    this.usageHistory = usageHistory;
    this.config = {
      weights: config?.weights || { usage: 40, concurrency: 30, health: 30 },
      enablePrediction: config?.enablePrediction ?? true,
      minScoreThreshold: config?.minScoreThreshold ?? 0.3,
      verbose: config?.verbose ?? false,
    };
    this.errorTracking = new Map();

    this.log('SmartRouter initialized');
  }

  /**
   * Select the best account from available accounts
   * @param accounts - Array of available accounts
   * @param sessionId - Session ID (for logging/debugging)
   * @returns Selection result with best account
   */
  selectBestAccount(
    accounts: CodingPlanAccount[],
    sessionId?: string
  ): AccountSelectionResult {
    if (accounts.length === 0) {
      throw new Error('No available accounts to select from');
    }

    if (accounts.length === 1) {
      const account = accounts[0];
      return {
        accountId: account.id,
        accountName: account.name,
        score: this.calculateScore(account),
        reason: 'Only one account available',
      };
    }

    // Score each account
    const scored = accounts.map((account) => ({
      account,
      score: this.calculateScore(account),
    }));

    // Filter out accounts below minimum score
    const qualified = scored.filter(
      (s) => s.score >= this.config.minScoreThreshold! * 100
    );

    // If all accounts are below threshold, use the best one anyway
    const candidates = qualified.length > 0 ? qualified : scored;

    // Sort by score (highest first)
    candidates.sort((a, b) => b.score - a.score);

    const selected = candidates[0];
    const predictedExhaustion = this.config.enablePrediction
      ? this.predictExhaustionTime(selected.account.id)
      : undefined;

    this.log(
      `Selected account ${selected.account.name} (score: ${selected.score.toFixed(1)}) for session ${sessionId || 'unknown'}`
    );

    return {
      accountId: selected.account.id,
      accountName: selected.account.name,
      score: selected.score,
      reason: this.getScoreReason(selected.account, selected.score),
      predictedExhaustionTime: predictedExhaustion || undefined,
    };
  }

  /**
   * Calculate account score (0-100)
   * @param account - Account to score
   * @returns Score value
   */
  calculateScore(account: CodingPlanAccount): number {
    let score = 100;

    // Usage score (40 points max)
    // Lower usage = higher score
    const usageRatio =
      account.config.last5HoursLimit > 0
        ? account.usage.last5Hours / account.config.last5HoursLimit
        : 0;
    const usageScore = (1 - usageRatio) * this.config.weights!.usage;
    score -= usageRatio * this.config.weights!.usage;

    // Concurrency score (30 points max)
    // More available slots = higher score
    const concurrencyRatio =
      account.concurrency.max > 0
        ? account.concurrency.current / account.concurrency.max
        : 0;
    score -= concurrencyRatio * this.config.weights!.concurrency;

    // Health score (30 points max)
    // Lower error rate = higher score
    const errorRate = this.getErrorRate(account.id);
    score -= errorRate * this.config.weights!.health;

    // Penalty for being in 'limited' or 'error' status
    if (account.status === 'limited' || account.status === 'error') {
      score *= 0.5; // 50% penalty
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Get the reason for a score
   * @param account - Account
   * @param score - Score value
   * @returns Human-readable reason
   */
  getScoreReason(account: CodingPlanAccount, score: number): string {
    const reasons: string[] = [];

    const usageRatio =
      account.config.last5HoursLimit > 0
        ? account.usage.last5Hours / account.config.last5HoursLimit
        : 0;

    if (usageRatio > 0.8) {
      reasons.push('high usage');
    } else if (usageRatio < 0.2) {
      reasons.push('low usage');
    }

    const concurrencyRatio =
      account.concurrency.max > 0
        ? account.concurrency.current / account.concurrency.max
        : 0;

    if (concurrencyRatio > 0.8) {
      reasons.push('high concurrency');
    } else if (concurrencyRatio < 0.2) {
      reasons.push('low concurrency');
    }

    const errorRate = this.getErrorRate(account.id);
    if (errorRate > 0.1) {
      reasons.push('high error rate');
    } else if (errorRate < 0.01) {
      reasons.push('excellent health');
    }

    if (account.status === 'limited') {
      reasons.push('account limited');
    } else if (account.status === 'error') {
      reasons.push('account error');
    }

    if (reasons.length === 0) {
      reasons.push('balanced');
    }

    return `Score ${score.toFixed(0)}: ${reasons.join(', ')}`;
  }

  /**
   * Record a request outcome for health tracking
   * @param accountId - Account ID
   * @param success - Whether request succeeded
   */
  recordRequest(accountId: string, success: boolean): void {
    let tracking = this.errorTracking.get(accountId);
    if (!tracking) {
      tracking = {
        totalRequests: 0,
        totalErrors: 0,
        consecutiveErrors: 0,
      };
      this.errorTracking.set(accountId, tracking);
    }

    tracking.totalRequests++;

    if (!success) {
      tracking.totalErrors++;
      tracking.consecutiveErrors++;
      tracking.lastErrorAt = new Date();
    } else {
      tracking.consecutiveErrors = 0;
    }

    // Limit memory usage - reset tracking for very high counts
    if (tracking.totalRequests > 10000) {
      tracking.totalRequests = Math.floor(tracking.totalRequests / 2);
      tracking.totalErrors = Math.floor(tracking.totalErrors / 2);
    }
  }

  /**
   * Get error rate for an account
   * @param accountId - Account ID
   * @returns Error rate (0-1)
   */
  getErrorRate(accountId: string): number {
    const tracking = this.errorTracking.get(accountId);
    if (!tracking || tracking.totalRequests === 0) {
      return 0;
    }
    return tracking.totalErrors / tracking.totalRequests;
  }

  /**
   * Get error tracking info for an account
   * @param accountId - Account ID
   * @returns Error tracking info
   */
  getErrorTracking(accountId: string): ErrorTracking | undefined {
    return this.errorTracking.get(accountId);
  }

  /**
   * Predict when an account will exhaust its quota
   * @param accountId - Account ID
   * @returns Predicted exhaustion time or null if cannot predict
   */
  predictExhaustionTime(accountId: string): Date | null {
    return this.usageHistory.predictExhaustionTime(accountId);
  }

  /**
   * Get accounts sorted by score
   * @param accounts - Array of available accounts
   * @returns Accounts with scores sorted
   */
  getRankedAccounts(
    accounts: CodingPlanAccount[]
  ): Array<{ account: CodingPlanAccount; score: number; reason: string }> {
    return accounts
      .map((account) => ({
        account,
        score: this.calculateScore(account),
        reason: this.getScoreReason(account, this.calculateScore(account)),
      }))
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Clear error tracking data
   * @param accountId - Account ID (optional, clears all if not provided)
   */
  clearErrorTracking(accountId?: string): void {
    if (accountId) {
      this.errorTracking.delete(accountId);
      this.log(`Cleared error tracking for account ${accountId}`);
    } else {
      this.errorTracking.clear();
      this.log('Cleared all error tracking');
    }
  }

  /**
   * Get router statistics
   */
  getStats(): {
    totalAccountsTracked: number;
    accountsWithErrors: number;
    averageErrorRate: number;
  } {
    const accountsWithErrors = Array.from(this.errorTracking.values()).filter(
      (t) => t.totalErrors > 0
    ).length;

    let totalErrorRate = 0;
    for (const tracking of this.errorTracking.values()) {
      if (tracking.totalRequests > 0) {
        totalErrorRate += tracking.totalErrors / tracking.totalRequests;
      }
    }

    return {
      totalAccountsTracked: this.errorTracking.size,
      accountsWithErrors,
      averageErrorRate:
        this.errorTracking.size > 0
          ? totalErrorRate / this.errorTracking.size
          : 0,
    };
  }

  /**
   * Log message if verbose mode is enabled
   */
  private log(message: string): void {
    if (this.config.verbose) {
      console.log(`[SmartRouter] ${message}`);
    }
  }
}

/**
 * Create and initialize SmartRouter
 * @param usageHistory - UsageHistoryService instance
 * @param config - Router configuration
 * @returns SmartRouter instance
 */
export function createSmartRouter(
  usageHistory: UsageHistoryService,
  config?: SmartRouterConfig
): SmartRouter {
  return new SmartRouter(usageHistory, config);
}
