import { PoolManager } from './pool-manager';
import { ConcurrencyManager } from './concurrency-manager';
import { SessionBinder } from './session-binder';
import { SmartRouter } from './smart-router';
import {
  AccountSelectionResult,
  AccountPoolConfig,
  CodingPlanAccount,
} from '../types/pool';
import { extractSessionId as extractSessionIdUtil } from '../utils/session-id';

/**
 * Request data interface
 */
interface RequestData {
  sessionId?: string;
  conversation_id?: string;
  headers?: Record<string, string>;
  body: {
    messages?: any[];
    [key: string]: any;
  };
  [key: string]: any;
}

/**
 * Pool Router
 *
 * Routes requests to appropriate Coding Plan accounts based on:
 * - Session binding (same conversation uses same account)
 * - Account availability (usage limits, concurrency slots)
 * - Load balancing (distribute across available accounts)
 *
 * Features:
 * - Session-based account binding with TTL
 * - Automatic account selection
 * - Concurrency slot management
 * - Error recovery and account switching
 */
export class PoolRouter {
  private poolManager: PoolManager;
  private concurrencyManager: ConcurrencyManager;
  private sessionBinder: SessionBinder;
  private config: AccountPoolConfig;
  private smartRouter?: SmartRouter;

  /**
   * Create PoolRouter instance
   * @param poolManager - PoolManager instance
   * @param concurrencyManager - ConcurrencyManager instance
   * @param config - Account pool configuration
   * @param smartRouter - Optional SmartRouter instance for intelligent account selection
   */
  constructor(
    poolManager: PoolManager,
    concurrencyManager: ConcurrencyManager,
    config: AccountPoolConfig,
    smartRouter?: SmartRouter
  ) {
    this.poolManager = poolManager;
    this.concurrencyManager = concurrencyManager;
    this.config = config;
    this.smartRouter = smartRouter;
    this.sessionBinder = new SessionBinder(
      {
        ttlMinutes: config.sessionBinding.ttlMinutes,
        breakOnLimited: config.sessionBinding.breakOnLimited,
      },
      {
        onBind: (sessionId, accountId) => {
          console.log(`[PoolRouter] SessionBinder onBind: ${sessionId} -> ${accountId}`);
        },
        onUnbind: (sessionId, accountId) => {
          console.log(`[PoolRouter] SessionBinder onUnbind: ${sessionId} was bound to ${accountId}`);
        },
        onAccountLimited: (accountId, sessions) => {
          console.log(`[PoolRouter] SessionBinder onAccountLimited: ${accountId} affected ${sessions.length} sessions`);
        },
      }
    );
  }

  /**
   * Select an account for the request
   * @param request - Request data
   * @returns Account selection result
   * @throws Error if no accounts available
   */
  async selectAccount(request: RequestData): Promise<AccountSelectionResult> {
    // Extract session ID from request
    const sessionId = extractSessionIdUtil(request);

    // Debug: Log all accounts status
    const allAccounts = this.poolManager.getAllAccounts();
    console.log(`[PoolRouter] selectAccount called, total accounts: ${allAccounts.length}`);
    for (const acc of allAccounts) {
      const isAvailable = this.poolManager.isAccountAvailable(acc);
      console.log(`[PoolRouter] Account ${acc.name} (${acc.id}): status=${acc.status}, concurrency=${acc.concurrency.current}/${acc.concurrency.max}, usage5h=${acc.usage.last5Hours}/${acc.config.last5HoursLimit}, available=${isAvailable}`);
    }

    // Priority 1: Check session binding
    if (sessionId && this.config.sessionBinding.enabled) {
      const boundAccountId = this.sessionBinder.getBoundAccount(sessionId);

      if (boundAccountId) {
        const account = this.poolManager.getAccount(boundAccountId);

        if (account && this.poolManager.isAccountAvailable(account)) {
          // Try to acquire concurrency slot
          const acquired = await this.concurrencyManager.acquireSlot(
            boundAccountId,
            sessionId
          );
          if (acquired) {
            console.log(
              `[PoolRouter] Using bound account: ${boundAccountId} for session ${sessionId}`
            );
            return {
              accountId: boundAccountId,
              reason: 'session_binding',
              sessionId,
            };
          }
        }

        // Bound account not available, remove binding
        console.log(
          `[PoolRouter] Bound account ${boundAccountId} not available, removing binding`
        );
        this.sessionBinder.unbind(sessionId);
      }
    }

    // Priority 2: Select from available accounts
    const availableAccounts = this.poolManager.getAvailableAccounts();
    console.log(`[PoolRouter] Available accounts count: ${availableAccounts.length}`);

    if (availableAccounts.length === 0) {
      throw new Error(
        'No accounts available: all accounts are at capacity or unavailable'
      );
    }

    // Select account with most available capacity (lowest usage percentage)
    const selected = this.selectBestAccount(availableAccounts);

    // Acquire concurrency slot
    if (sessionId) {
      const acquired = await this.concurrencyManager.acquireSlot(
        selected.id,
        sessionId
      );
      if (!acquired) {
        throw new Error(`Failed to acquire slot on account ${selected.id}`);
      }

      // Create session binding
      if (this.config.sessionBinding.enabled) {
        this.sessionBinder.bind(sessionId, selected.id);
      }
    }

    console.log(
      `[PoolRouter] Selected account: ${selected.name} (${selected.id})`
    );

    return {
      accountId: selected.id,
      reason: 'available',
      sessionId,
    };
  }

  /**
   * Select the best account from available accounts
   * @param accounts - Array of available accounts
   * @returns Best account to use
   */
  private selectBestAccount(
    accounts: CodingPlanAccount[]
  ): CodingPlanAccount {
    // Use SmartRouter if available for intelligent selection
    if (this.smartRouter) {
      const selection = this.smartRouter.selectBestAccount(accounts);
      return accounts.find(a => a.id === selection.accountId) || accounts[0];
    }

    // Fallback: Sort by available capacity (lowest usage first)
    return accounts.sort((a, b) => {
      const aRatio = a.usage.last5Hours / a.config.last5HoursLimit;
      const bRatio = b.usage.last5Hours / b.config.last5HoursLimit;
      return aRatio - bRatio;
    })[0];
  }

  /**
   * Handle request completion
   * @param sessionId - Session ID
   * @param success - Whether the request was successful (default: true)
   */
  async onRequestComplete(sessionId: string, success: boolean = true): Promise<void> {
    const accountId = this.concurrencyManager.getSessionAccount(sessionId);
    if (accountId) {
      await this.concurrencyManager.releaseSlot(accountId, sessionId);

      // Record success with SmartRouter for health tracking
      this.smartRouter?.recordRequest(accountId, success);

      console.log(
        `[PoolRouter] Request completed, released slot: ${sessionId}`
      );
    }
  }

  /**
   * Handle error (trigger account switch)
   * @param sessionId - Session ID
   * @param error - Error that occurred
   * @returns New account selection or null if cannot recover
   */
  async handleError(
    sessionId: string,
    error: Error
  ): Promise<AccountSelectionResult | null> {
    // Get current bound account before removing
    const currentAccountId = this.sessionBinder.getBoundAccount(sessionId);

    // Remove current binding if exists
    if (currentAccountId) {
      this.sessionBinder.unbind(sessionId);
      console.log(
        `[PoolRouter] Removed binding due to error: ${sessionId} was bound to ${currentAccountId}`
      );
    }

    // Release current slot
    await this.concurrencyManager.releaseAllSlots(sessionId);

    // Check if error is retryable
    const isRetryable = this.isRetryableError(error);
    if (!isRetryable) {
      console.log(
        `[PoolRouter] Non-retryable error, cannot recover: ${error.message}`
      );
      return null;
    }

    // Try to select a different account
    try {
      const request = { sessionId, body: {} };
      const selection = await this.selectAccount(request as RequestData);
      console.log(
        `[PoolRouter] Recovered from error, switched to account: ${selection.accountId}`
      );
      return selection;
    } catch (e: any) {
      console.error(
        `[PoolRouter] Failed to recover from error: ${e.message}`
      );
      return null;
    }
  }

  /**
   * Check if error is retryable
   * @param error - Error to check
   * @returns True if error is retryable
   */
  private isRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return (
      message.includes('rate limit') ||
      message.includes('quota') ||
      message.includes('too many requests') ||
      message.includes('temporary') ||
      message.includes('timeout')
    );
  }

  /**
   * Get session binding info
   * @param sessionId - Session ID
   * @returns Bound account ID or undefined
   */
  getSessionBinding(sessionId: string): string | undefined {
    const binding = this.sessionBinder.getBinding(sessionId);
    return binding?.accountId;
  }

  /**
   * Remove session binding
   * @param sessionId - Session ID
   */
  removeSessionBinding(sessionId: string): void {
    this.sessionBinder.unbind(sessionId);
  }

  /**
   * Get pool manager instance
   */
  getPoolManager(): PoolManager {
    return this.poolManager;
  }

  /**
   * Get concurrency manager instance
   */
  getConcurrencyManager(): ConcurrencyManager {
    return this.concurrencyManager;
  }

  /**
   * Get all session bindings
   */
  getSessionBindings(): Map<string, string> {
    const bindings = this.sessionBinder.getAllBindings();
    const map = new Map<string, string>();
    for (const binding of bindings) {
      map.set(binding.sessionId, binding.accountId);
    }
    return map;
  }

  /**
   * Get session binder instance
   */
  getSessionBinder(): SessionBinder {
    return this.sessionBinder;
  }

  /**
   * Set the SmartRouter instance
   * @param smartRouter - SmartRouter instance
   */
  setSmartRouter(smartRouter: SmartRouter): void {
    this.smartRouter = smartRouter;
    console.log('[PoolRouter] SmartRouter initialized');
  }

  /**
   * Get the SmartRouter instance
   */
  getSmartRouter(): SmartRouter | undefined {
    return this.smartRouter;
  }

  /**
   * Handle account becoming limited
   * @param accountId - Account ID that became limited
   */
  handleAccountLimited(accountId: string): void {
    console.log(`[PoolRouter] Handling account limited: ${accountId}`);
    this.sessionBinder.handleAccountLimited(accountId);
  }
}
