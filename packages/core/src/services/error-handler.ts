import { PoolManager } from './pool-manager';
import { PoolRouter } from './pool-router';
import { SmartRouter } from './smart-router';
import {
  ApiError,
  RetryRecord,
  ErrorHandlingResult,
  ZaiErrorTypes,
  ZaiErrorType,
} from '../types/pool';
import { AccountSelectionResult } from '../types/pool';

/**
 * Error handler configuration
 */
export interface ErrorHandlerOptions {
  /** Maximum retry attempts per session (default: 3) */
  maxRetries?: number;
  /** Time window for retry limit in milliseconds (default: 1 minute) */
  retryWindowMs?: number;
  /** Whether to enable verbose logging */
  verbose?: boolean;
}

/**
 * Error Handler
 *
 * Identifies Z.ai API errors and handles account switching automatically.
 *
 * Features:
 * - Error type recognition (rate limit, quota, server errors)
 * - Automatic account switching on retryable errors
 * - Retry loop prevention (max 3 switches per minute)
 * - Account status management on quota errors
 *
 * Usage:
 * ```typescript
 * const errorHandler = new ErrorHandler(poolManager, poolRouter);
 *
 * try {
 *   const response = await makeRequest();
 * } catch (error) {
 *   const result = await errorHandler.handleErrorAndSwitch(
 *     sessionId,
 *     failedAccountId,
 *     parseZaiError(error)
 *   );
 *
 *   if (result.shouldSwitch && result.newAccountId) {
 *     // Retry with new account
 *   }
 * }
 * ```
 */
export class ErrorHandler {
  private poolManager: PoolManager;
  private poolRouter: PoolRouter;
  private smartRouter?: SmartRouter;
  private retryHistory: Map<string, RetryRecord[]>;
  private options: Required<ErrorHandlerOptions>;

  /**
   * Create ErrorHandler instance
   * @param poolManager - PoolManager instance
   * @param poolRouter - PoolRouter instance
   * @param smartRouter - Optional SmartRouter instance for health tracking
   * @param options - Error handler configuration
   */
  constructor(
    poolManager: PoolManager,
    poolRouter: PoolRouter,
    smartRouter?: SmartRouter,
    options?: ErrorHandlerOptions
  ) {
    this.poolManager = poolManager;
    this.poolRouter = poolRouter;
    this.smartRouter = smartRouter;
    this.retryHistory = new Map();
    this.options = {
      maxRetries: options?.maxRetries ?? 3,
      retryWindowMs: options?.retryWindowMs ?? 60 * 1000,
      verbose: options?.verbose ?? false,
    };

    this.log('ErrorHandler initialized');
  }

  /**
   * Parse error from Z.ai API response
   *
   * Handles various error formats and normalizes to ApiError interface.
   *
   * @param error - Raw error object
   * @returns Parsed ApiError
   */
  static parseZaiError(error: any): ApiError {
    // HTTP response error (axios/fetch style)
    if (error.response?.data) {
      const data = error.response.data;
      return {
        code: data.error?.code || data.code,
        type: data.error?.type || data.type,
        message: data.error?.message || data.message || error.message,
        status: error.response.status,
        raw: data,
      };
    }

    // Already in ApiError format
    if (error.code || error.type) {
      return error as ApiError;
    }

    // Network error or other
    return {
      message: error.message || 'Unknown error',
      raw: error,
    };
  }

  /**
   * Check if error should trigger account switch
   *
   * @param error - Error to check
   * @returns True if should switch account
   */
  shouldSwitchAccount(error: ApiError): boolean {
    const errorCode = (error.code || error.type || '') as ZaiErrorType;

    // Check against switchable error types
    if (this.isSwitchableErrorType(errorCode)) {
      return true;
    }

    // Check HTTP status codes
    if (error.status) {
      // 429: Too Many Requests
      // 502, 503, 504: Server errors
      if ([429, 502, 503, 504].includes(error.status)) {
        return true;
      }
    }

    // Check message patterns
    const message = error.message.toLowerCase();
    if (
      message.includes('rate limit') ||
      message.includes('too many requests') ||
      message.includes('quota') ||
      message.includes('quota exceeded') ||
      message.includes('insufficient quota') ||
      message.includes('concurrent limit') ||
      message.includes('server error') ||
      message.includes('service unavailable')
    ) {
      return true;
    }

    return false;
  }

  /**
   * Check if error is a quota-related error
   *
   * @param error - Error to check
   * @returns True if quota error
   */
  isQuotaError(error: ApiError): boolean {
    const errorCode = error.code || error.type;
    return (
      errorCode === ZaiErrorTypes.QUOTA_EXHAUSTED ||
      errorCode === ZaiErrorTypes.INSUFFICIENT_QUOTA
    );
  }

  /**
   * Handle error and switch to new account
   *
   * @param sessionId - Session ID
   * @param failedAccountId - Account ID that failed
   * @param error - Error that occurred
   * @returns Error handling result with new account selection
   */
  async handleErrorAndSwitch(
    sessionId: string,
    failedAccountId: string,
    error: ApiError
  ): Promise<ErrorHandlingResult> {
    this.log(
      `Handling error for session ${sessionId}, account ${failedAccountId}: ${error.code || error.type || error.message}`
    );

    // Record error with SmartRouter for health tracking
    this.smartRouter?.recordRequest(failedAccountId, false);

    // Record error
    this.recordError(sessionId, failedAccountId, error);

    // Check if should stop switching
    if (this.shouldStopSwitching(sessionId)) {
      this.log(`Stopped switching for session ${sessionId} (retry limit reached)`);
      return {
        shouldSwitch: false,
        shouldRetry: false,
        userMessage:
          'Unable to complete request after multiple account switches. Please try again later.',
      };
    }

    // Check if error requires account switch
    if (!this.shouldSwitchAccount(error)) {
      this.log(`Error ${error.code} does not require account switch`);
      return {
        shouldSwitch: false,
        shouldRetry: false,
        userMessage: error.message,
      };
    }

    // Mark account as limited if quota error
    if (this.isQuotaError(error)) {
      this.markAccountLimited(failedAccountId, error);
    }

    // Release slot for failed account
    try {
      await this.poolRouter.getConcurrencyManager().releaseSlot(failedAccountId, sessionId);
      this.log(`Released slot for failed account ${failedAccountId}`);
    } catch (e) {
      this.log(`Failed to release slot: ${(e as Error).message}`);
    }

    // Select new account (excluding failed one)
    const newSelection = await this.selectAccountWithExclusion(
      sessionId,
      failedAccountId
    );

    if (newSelection) {
      this.log(
        `Switched from ${failedAccountId} to ${newSelection.accountId} due to ${error.code}`
      );
      return {
        shouldSwitch: true,
        shouldRetry: true,
        newAccountId: newSelection.accountId,
      };
    } else {
      this.log('No available accounts to switch to');
      return {
        shouldSwitch: false,
        shouldRetry: false,
        userMessage:
          'No available accounts to process request. Please try again later.',
      };
    }
  }

  /**
   * Record error in history for retry tracking
   *
   * @param sessionId - Session ID
   * @param accountId - Account ID that failed
   * @param error - Error details
   */
  recordError(sessionId: string, accountId: string, error: ApiError): void {
    const history = this.retryHistory.get(sessionId) || [];
    const record: RetryRecord = {
      accountId,
      timestamp: Date.now(),
      error,
    };

    history.push(record);
    this.retryHistory.set(sessionId, history);

    this.log(
      `Recorded error for session ${sessionId}: ${accountId} - ${error.code || error.type}`
    );
  }

  /**
   * Check if should stop switching accounts (avoid infinite loop)
   *
   * @param sessionId - Session ID
   * @returns True if should stop switching
   */
  shouldStopSwitching(sessionId: string): boolean {
    const history = this.retryHistory.get(sessionId) || [];

    // Count recent errors within retry window
    const now = Date.now();
    const windowStart = now - this.options.retryWindowMs;
    const recentErrors = history.filter((r) => r.timestamp > windowStart);

    const shouldStop = recentErrors.length >= this.options.maxRetries;

    if (shouldStop) {
      this.log(
        `Retry limit reached for session ${sessionId}: ${recentErrors.length} errors in ${this.options.retryWindowMs / 1000}s`
      );
    }

    return shouldStop;
  }

  /**
   * Reset error history for a session
   *
   * Call this after successful request completion.
   *
   * @param sessionId - Session ID
   */
  resetHistory(sessionId: string): void {
    this.retryHistory.delete(sessionId);
    this.log(`Reset error history for session ${sessionId}`);
  }

  /**
   * Get error history for a session
   *
   * @param sessionId - Session ID
   * @returns Array of retry records
   */
  getHistory(sessionId: string): RetryRecord[] {
    return this.retryHistory.get(sessionId) || [];
  }

  /**
   * Get error handler statistics
   */
  getStats(): {
    activeSessions: number;
    totalRetries: number;
  } {
    let totalRetries = 0;
    for (const history of this.retryHistory.values()) {
      totalRetries += history.length;
    }

    return {
      activeSessions: this.retryHistory.size,
      totalRetries,
    };
  }

  /**
   * Clear all error history
   */
  clearAllHistory(): void {
    this.retryHistory.clear();
    this.log('Cleared all error history');
  }

  /**
   * Mark account as limited due to quota error
   *
   * @param accountId - Account ID
   * @param error - Error details
   */
  private markAccountLimited(accountId: string, error: ApiError): void {
    const account = this.poolManager.getAccount(accountId);
    if (account) {
      account.status = 'limited';
      account.limitedInfo = {
        since: new Date(),
        reason: error.code as any,
        errorMessage: error.message,
      };
      this.log(`Marked account ${accountId} as limited`);

      // Notify pool router to break bindings
      this.poolRouter.handleAccountLimited(accountId);
    }
  }

  /**
   * Select new account excluding failed one
   *
   * @param sessionId - Session ID
   * @param excludeAccountId - Account ID to exclude
   * @returns New account selection or null
   */
  private async selectAccountWithExclusion(
    sessionId: string,
    excludeAccountId: string
  ): Promise<AccountSelectionResult | null> {
    // Get available accounts excluding failed one
    const availableAccounts = this.poolManager
      .getAvailableAccounts()
      .filter(
        (a) =>
          a.id !== excludeAccountId &&
          a.status === 'active' &&
          a.concurrency.current < a.concurrency.max
      );

    if (availableAccounts.length === 0) {
      return null;
    }

    // Select best account (lowest usage ratio)
    const selected = availableAccounts.sort((a, b) => {
      const aRatio = a.usage.last5Hours / a.config.last5HoursLimit;
      const bRatio = b.usage.last5Hours / b.config.last5HoursLimit;
      return aRatio - bRatio;
    })[0];

    // Acquire concurrency slot
    const concurrencyManager = this.poolRouter.getConcurrencyManager();
    const acquired = await concurrencyManager.acquireSlot(selected.id, sessionId);

    if (!acquired) {
      return null;
    }

    // Create session binding using SessionBinder directly
    const sessionBinder = this.poolRouter.getSessionBinder();
    sessionBinder.bind(sessionId, selected.id);

    return {
      accountId: selected.id,
      reason: 'available',
      sessionId,
    };
  }

  /**
   * Check if error type is switchable
   *
   * @param errorCode - Error code/type to check
   * @returns True if should switch
   */
  private isSwitchableErrorType(errorCode: ZaiErrorType | string): boolean {
    const switchableErrors: ZaiErrorType[] = [
      ZaiErrorTypes.RATE_LIMIT_EXCEEDED,
      ZaiErrorTypes.TOO_MANY_REQUESTS,
      ZaiErrorTypes.QUOTA_EXHAUSTED,
      ZaiErrorTypes.INSUFFICIENT_QUOTA,
      ZaiErrorTypes.CONCURRENT_LIMIT_REACHED,
      ZaiErrorTypes.INTERNAL_ERROR,
      ZaiErrorTypes.SERVICE_UNAVAILABLE,
    ];

    return switchableErrors.includes(errorCode as ZaiErrorType);
  }

  /**
   * Log message if verbose mode is enabled
   */
  private log(message: string): void {
    if (this.options.verbose) {
      console.log(`[ErrorHandler] ${message}`);
    }
  }
}

/**
 * Re-export error types for convenience
 */
export { ZaiErrorTypes };
