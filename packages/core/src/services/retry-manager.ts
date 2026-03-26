import { FastifyRequest } from 'fastify';
import { getPoolRouter, getRateLimitRecoveryService } from '../utils/router';

/**
 * Retry configuration
 */
export interface RetryConfig {
  /** Maximum number of retries */
  maxRetries: number;
  /** Delay between retries in milliseconds */
  retryDelayMs: number;
  /** Enable automatic account switching on 429 */
  enableAccountSwitch: boolean;
}

/**
 * Retry result
 */
export interface RetryResult<T> {
  /** Whether retry was successful */
  success: boolean;
  /** Response data */
  data?: T;
  /** Error if failed */
  error?: Error;
  /** Number of attempts */
  attempts: number;
  /** Account IDs tried */
  accountsTried: string[];
}

/**
 * Request function type
 */
export type RequestFunction<T> = (account?: any) => Promise<T>;

/**
 * Check if error is rate limit (429)
 */
function isRateLimitError(error: any): boolean {
  if (error?.status === 429) {
    return true;
  }
  const message = (error?.message || '').toLowerCase();
  return message.includes('rate limit') || message.includes('too many requests');
}

/**
 * Retry manager for handling automatic account switching on rate limit errors
 *
 * This service provides seamless failover when encountering rate limit errors
 * by automatically switching to available accounts in the pool.
 */
export class RetryManager {
  private config: RetryConfig;

  constructor(config?: Partial<RetryConfig>) {
    this.config = {
      maxRetries: config?.maxRetries ?? 3,
      retryDelayMs: config?.retryDelayMs ?? 1000,
      enableAccountSwitch: config?.enableAccountSwitch ?? true,
    };
  }

  /**
   * Execute a request with automatic retry and account switching
   *
   * @param req - Fastify request object
   * @param requestFn - Function to execute the request
   * @returns Retry result with data or error
   */
  async executeWithRetry<T>(
    req: FastifyRequest,
    requestFn: RequestFunction<T>
  ): Promise<RetryResult<T>> {
    const poolRouter = getPoolRouter();
    const recoveryService = getRateLimitRecoveryService();

    // If pool router is not available, execute without retry
    if (!poolRouter || !this.config.enableAccountSwitch) {
      try {
        const data = await requestFn();
        return {
          success: true,
          data,
          attempts: 1,
          accountsTried: [],
        };
      } catch (error: any) {
        return {
          success: false,
          error,
          attempts: 1,
          accountsTried: [],
        };
      }
    }

    const accountsTried: string[] = [];
    let lastError: Error | undefined;
    const sessionId = (req as any).sessionId;

    // Try with current account and fallback accounts
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      // Get current pool account from request
      let currentAccount = (req as any).poolAccount;
      const currentAccountId = currentAccount?.id;

      if (currentAccountId) {
        accountsTried.push(currentAccountId);
      }

      try {
        // Execute request with current account
        const data = await requestFn(currentAccount);
        
        // Success - return result
        console.log(
          `[RetryManager] Request succeeded on attempt ${attempt + 1}${attempt > 0 ? `, switched to account ${currentAccountId}` : ''}`
        );
        
        return {
          success: true,
          data,
          attempts: attempt + 1,
          accountsTried,
        };
      } catch (error: any) {
        lastError = error;

        // Check if this is a rate limit error
        if (isRateLimitError(error)) {
          console.log(
            `[RetryManager] Rate limit error on attempt ${attempt + 1}, account ${currentAccountId}`
          );

          // Mark current account as limited
          if (currentAccountId && recoveryService) {
            recoveryService.markAccountLimitedWithRecovery(
              currentAccountId,
              'rate_limit',
              undefined,
              error.message
            );
          }

          // Release current account slot (MUST pass accountId for composite key lookup)
          if (sessionId && poolRouter && currentAccountId) {
            await poolRouter.onRequestComplete(sessionId, false, currentAccountId);
            poolRouter.removeSessionBinding(sessionId);
            // Mark as released so close handlers don't double-release the OLD slot
            // during the retry window
            (req as any)._poolSlotReleased = true;
          }

          // Try to switch to a different account
          if (attempt < this.config.maxRetries) {
            try {
              const selection = await poolRouter.selectAccount({
                sessionId,
                headers: req.headers,
                body: req.body,
              });

              if (selection.accountId !== currentAccountId) {
                console.log(
                  `[RetryManager] Switching from ${currentAccountId} to ${selection.accountId}`
                );
              } else {
                console.log(
                  `[RetryManager] Re-selected same account ${currentAccountId}, retrying`
                );
              }

              // Update request with new (or same) account
              const newAccount = poolRouter.getPoolManager().getAccount(selection.accountId);
              if (newAccount) {
                (req as any).poolAccount = newAccount;
                // Reset the flag so close handlers CAN release the NEW slot
                (req as any)._poolSlotReleased = false;

                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, this.config.retryDelayMs));
                continue;
              } else {
                // Account disappeared after selection — release the orphaned slot
                console.warn(
                  `[RetryManager] Account ${selection.accountId} not found after selection, releasing orphaned slot`
                );
                await poolRouter.onRequestComplete(sessionId, false, selection.accountId);
              }
            } catch (selectError: any) {
              console.warn(
                `[RetryManager] Failed to select new account: ${selectError.message}`
              );
            }
          }
        } else {
          // Not a rate limit error, don't retry
          break;
        }
      }
    }

    // All retries failed
    console.error(
      `[RetryManager] All ${accountsTried.length} attempts failed, tried accounts: ${accountsTried.join(', ')}`
    );

    return {
      success: false,
      error: lastError,
      attempts: accountsTried.length,
      accountsTried,
    };
  }

  /**
   * Update retry configuration
   * @param config - Partial configuration to update
   */
  updateConfig(config: Partial<RetryConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   * @returns Current retry configuration
   */
  getConfig(): RetryConfig {
    return { ...this.config };
  }
}

// Global retry manager instance
let retryManagerInstance: RetryManager | null = null;

/**
 * Initialize or get the retry manager
 * @param config - Optional configuration
 * @returns RetryManager instance
 */
export function getRetryManager(config?: Partial<RetryConfig>): RetryManager {
  if (!retryManagerInstance) {
    retryManagerInstance = new RetryManager(config);
  }
  return retryManagerInstance;
}
