import { PoolManager } from './pool-manager';
import { CodingPlanAccount } from '../types/pool';

/**
 * Rate limit recovery service
 *
 * Automatically monitors and recovers accounts that were marked as limited
 * due to rate limit errors.
 */
export class RateLimitRecoveryService {
  private poolManager: PoolManager;
  private checkInterval: NodeJS.Timeout | null = null;
  private checkIntervalMinutes: number;
  private defaultRecoveryMinutes: number;

  /**
   * Create RateLimitRecoveryService instance
   * @param poolManager - PoolManager instance
   * @param config - Recovery configuration
   */
  constructor(
    poolManager: PoolManager,
    config: {
      checkIntervalMinutes?: number;
      defaultRecoveryMinutes?: number;
    } = {}
  ) {
    this.poolManager = poolManager;
    this.checkIntervalMinutes = config.checkIntervalMinutes ?? 60;
    this.defaultRecoveryMinutes = config.defaultRecoveryMinutes ?? 60;
  }

  /**
   * Start the recovery check loop
   */
  start(): void {
    if (this.checkInterval) {
      console.log('[RateLimitRecovery] Service already started');
      return;
    }

    console.log(
      `[RateLimitRecovery] Service started (check interval: ${this.checkIntervalMinutes}min)`
    );

    // Run immediately on start
    this.checkAndRecoverAccounts();

    // Schedule periodic checks
    this.checkInterval = setInterval(() => {
      this.checkAndRecoverAccounts();
    }, this.checkIntervalMinutes * 60 * 1000);
  }

  /**
   * Stop the recovery check loop
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      console.log('[RateLimitRecovery] Service stopped');
    }
  }

  /**
   * Check all limited accounts and recover if their recovery time has passed
   */
  private checkAndRecoverAccounts(): void {
    const accounts = this.poolManager.getAllAccounts();
    const now = new Date();
    let recoveredCount = 0;

    for (const account of accounts) {
      if (account.status === 'limited' && account.limitedInfo?.recoverAt) {
        if (now >= account.limitedInfo.recoverAt) {
          try {
            this.poolManager.recoverAccount(account.id);
            console.log(
              `[RateLimitRecovery] Account ${account.name} (${account.id}) recovered after rate limit`
            );
            recoveredCount++;
          } catch (error: any) {
            console.error(
              `[RateLimitRecovery] Failed to recover account ${account.id}: ${error.message}`
            );
          }
        }
      }
    }

    if (recoveredCount > 0) {
      console.log(`[RateLimitRecovery] Recovered ${recoveredCount} accounts`);
    }
  }

  /**
   * Mark an account as limited with automatic recovery
   * @param accountId - Account ID to mark as limited
   * @param reason - Limit reason
   * @param recoveryMinutes - Recovery duration in minutes (default: from config)
   * @param errorMessage - Optional error message
   */
  markAccountLimitedWithRecovery(
    accountId: string,
    reason: 'rate_limit' | 'quota_exhausted' | 'error' | 'manual',
    recoveryMinutes?: number,
    errorMessage?: string
  ): void {
    const recoveryDuration = recoveryMinutes ?? this.defaultRecoveryMinutes;
    const recoverAt = new Date(Date.now() + recoveryDuration * 60 * 1000);

    try {
      const account = this.poolManager.markAccountLimited(
        accountId,
        reason,
        errorMessage
      );

      // Set recovery time
      if (account.limitedInfo) {
        account.limitedInfo.recoverAt = recoverAt;
      }

      console.log(
        `[RateLimitRecovery] Account ${accountId} marked as limited, will recover at ${recoverAt.toISOString()}`
      );
    } catch (error: any) {
      console.error(
        `[RateLimitRecovery] Failed to mark account ${accountId} as limited: ${error.message}`
      );
    }
  }

  /**
   * Get recovery time for an account
   * @param accountId - Account ID
   * @returns Recovery time or undefined if not limited or no recovery time set
   */
  getRecoveryTime(accountId: string): Date | undefined {
    const account = this.poolManager.getAccount(accountId);
    return account?.limitedInfo?.recoverAt;
  }

  /**
   * Get status of recovery service
   * @returns Service status information
   */
  getStatus(): {
    running: boolean;
    checkIntervalMinutes: number;
    defaultRecoveryMinutes: number;
    accountsWaitingRecovery: Array<{
      accountId: string;
      accountName: string;
      recoverAt: Date;
      reason: string;
    }>;
  } {
    const accounts = this.poolManager.getAllAccounts();
    const now = new Date();

    const accountsWaitingRecovery = accounts
      .filter((a) => a.status === 'limited' && a.limitedInfo?.recoverAt)
      .map((a) => ({
        accountId: a.id,
        accountName: a.name,
        recoverAt: a.limitedInfo!.recoverAt!,
        reason: a.limitedInfo!.reason,
      }));

    return {
      running: this.checkInterval !== null,
      checkIntervalMinutes: this.checkIntervalMinutes,
      defaultRecoveryMinutes: this.defaultRecoveryMinutes,
      accountsWaitingRecovery,
    };
  }
}
