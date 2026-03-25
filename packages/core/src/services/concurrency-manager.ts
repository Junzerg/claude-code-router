import { CodingPlanAccount } from '../types/pool';
import { PoolManager } from './pool-manager';

/**
 * Session concurrency slot information
 */
interface SessionSlotInfo {
  /** Account ID the session is using */
  accountId: string;
  /** Slot acquisition timestamp */
  acquiredAt: Date;
  /** Last heartbeat timestamp */
  lastHeartbeat: Date;
  /** Number of active requests for this session (reference count) */
  activeRequests: number;
}

/**
 * Concurrency Manager
 *
 * Manages concurrency slots for Coding Plan account pool.
 *
 * Features:
 * - Slot acquire and release
 * - SSE connection disconnect detection
 * - Zombie connection cleanup
 */
export class ConcurrencyManager {
  private poolManager: PoolManager;
  private sessionSlots: Map<string, SessionSlotInfo>;
  private heartbeatCheckInterval?: NodeJS.Timeout;
  private readonly STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Create ConcurrencyManager instance
   * @param poolManager - PoolManager instance
   */
  constructor(poolManager: PoolManager) {
    this.poolManager = poolManager;
    this.sessionSlots = new Map();
  }

  /**
   * Acquire a concurrency slot
   * @param accountId - Account ID to acquire slot from
   * @param sessionId - Session ID requesting the slot
   * @returns True if successfully acquired, false otherwise
   */
  async acquireSlot(accountId: string, sessionId: string): Promise<boolean> {
    const account = this.poolManager.getAccount(accountId);
    if (!account) {
      console.warn(`[ConcurrencyManager] Account not found: ${accountId}`);
      return false;
    }

    // Check if already occupied by this session (do this before max concurrency check)
    if (account.concurrency.slots?.has(sessionId)) {
      console.debug(
        `[ConcurrencyManager] Session ${sessionId} already has slot on account ${accountId}, incrementing reference count`
      );
      // Update heartbeat and increment reference count
      const slotInfo = this.sessionSlots.get(sessionId);
      if (slotInfo) {
        slotInfo.lastHeartbeat = new Date();
        slotInfo.activeRequests++;
        this.sessionSlots.set(sessionId, slotInfo);
        console.log(
          `[ConcurrencyManager] Session ${sessionId} now has ${slotInfo.activeRequests} active requests`
        );
      }
      return true;
    }

    // Check if already at max concurrency
    if (account.concurrency.current >= account.concurrency.max) {
      console.debug(
        `[ConcurrencyManager] Account ${accountId} at max concurrency (${account.concurrency.current}/${account.concurrency.max})`
      );
      return false;
    }

    // Acquire the slot
    account.concurrency.current++;
    if (!account.concurrency.slots) {
      account.concurrency.slots = new Set();
    }
    account.concurrency.slots.add(sessionId);
    account.concurrency.lastUpdated = new Date();

    // Track session slot with reference count
    this.sessionSlots.set(sessionId, {
      accountId,
      acquiredAt: new Date(),
      lastHeartbeat: new Date(),
      activeRequests: 1, // Initialize with 1 for first request
    });

    console.log(
      `[ConcurrencyManager] Slot acquired: ${sessionId} -> ${accountId} (${account.concurrency.current}/${account.concurrency.max})`
    );
    return true;
  }

  /**
   * Release a concurrency slot
   * @param accountId - Account ID to release slot from
   * @param sessionId - Session ID releasing the slot
   */
  async releaseSlot(accountId: string, sessionId: string): Promise<void> {
    const account = this.poolManager.getAccount(accountId);
    if (!account) {
      console.warn(`[ConcurrencyManager] Account not found: ${accountId}`);
      return;
    }

    // Get slot info to decrement reference count
    const slotInfo = this.sessionSlots.get(sessionId);
    if (!slotInfo) {
      console.warn(`[ConcurrencyManager] Session slot not found: ${sessionId}`);
      return;
    }

    // Decrement reference count
    slotInfo.activeRequests--;
    console.log(
      `[ConcurrencyManager] Request completed for ${sessionId}, active requests remaining: ${slotInfo.activeRequests}`
    );

    // Only release account slot when all requests for this session are done
    if (slotInfo.activeRequests <= 0) {
      if (account.concurrency.slots?.has(sessionId)) {
        account.concurrency.slots.delete(sessionId);
        account.concurrency.current = Math.max(
          0,
          account.concurrency.current - 1
        );
        account.concurrency.lastUpdated = new Date();

        console.log(
          `[ConcurrencyManager] Slot released: ${sessionId} <- ${accountId} (${account.concurrency.current}/${account.concurrency.max})`
        );
      }

      // Remove session tracking
      this.sessionSlots.delete(sessionId);
    } else {
      // Update the slot info with decremented count
      this.sessionSlots.set(sessionId, slotInfo);
    }
  }

  /**
   * Release all slots for a session (called when user disconnects)
   * @param sessionId - Session ID to release all slots for
   */
  async releaseAllSlots(sessionId: string): Promise<void> {
    const slotInfo = this.sessionSlots.get(sessionId);
    if (!slotInfo) {
      return;
    }

    const account = this.poolManager.getAccount(slotInfo.accountId);
    if (!account) {
      console.warn(`[ConcurrencyManager] Account not found: ${slotInfo.accountId}`);
      this.sessionSlots.delete(sessionId);
      return;
    }

    // Force release: clear the slot from account regardless of active request count
    if (account.concurrency.slots?.has(sessionId)) {
      account.concurrency.slots.delete(sessionId);
      account.concurrency.current = Math.max(
        0,
        account.concurrency.current - 1
      );
      account.concurrency.lastUpdated = new Date();

      console.log(
        `[ConcurrencyManager] All slots released: ${sessionId} <- ${slotInfo.accountId} (was ${slotInfo.activeRequests} active requests, now ${account.concurrency.current}/${account.concurrency.max})`
      );
    }

    // Remove session tracking
    this.sessionSlots.delete(sessionId);
  }

  /**
   * Get the account ID for a session
   * @param sessionId - Session ID
   * @returns Account ID or undefined if not found
   */
  getSessionAccount(sessionId: string): string | undefined {
    const slotInfo = this.sessionSlots.get(sessionId);
    return slotInfo?.accountId;
  }

  /**
   * Check if a session has an active slot
   * @param sessionId - Session ID
   * @returns True if session has active slot
   */
  hasActiveSlot(sessionId: string): boolean {
    return this.sessionSlots.has(sessionId);
  }

  /**
   * Check if a session is still active (has heartbeat recently)
   * @param sessionId - Session ID
   * @returns True if session is active
   */
  isSessionActive(sessionId: string): boolean {
    const slotInfo = this.sessionSlots.get(sessionId);
    if (!slotInfo) {
      return false;
    }

    const now = Date.now();
    const lastHeartbeat = slotInfo.lastHeartbeat.getTime();
    return now - lastHeartbeat < this.STALE_THRESHOLD_MS;
  }

  /**
   * Start heartbeat check to clean up stale connections
   * @param intervalMs - Check interval in milliseconds (default: 60000)
   */
  startHeartbeatCheck(intervalMs: number = 60000): void {
    if (this.heartbeatCheckInterval) {
      console.warn(
        '[ConcurrencyManager] Heartbeat check already running'
      );
      return;
    }

    console.log(
      `[ConcurrencyManager] Starting heartbeat check (interval: ${intervalMs}ms)`
    );

    this.heartbeatCheckInterval = setInterval(async () => {
      await this.cleanupStaleSlots();
    }, intervalMs);
  }

  /**
   * Stop heartbeat check
   */
  stopHeartbeatCheck(): void {
    if (this.heartbeatCheckInterval) {
      clearInterval(this.heartbeatCheckInterval);
      this.heartbeatCheckInterval = undefined;
      console.log('[ConcurrencyManager] Heartbeat check stopped');
    }
  }

  /**
   * Clean up stale/zombie slots (sessions that haven't sent heartbeat)
   */
  private async cleanupStaleSlots(): Promise<void> {
    const now = Date.now();
    let cleanedCount = 0;

    const staleSessions: string[] = [];

    // First, identify all stale sessions
    for (const [sessionId, slotInfo] of this.sessionSlots.entries()) {
      const lastHeartbeat = slotInfo.lastHeartbeat.getTime();
      const age = now - lastHeartbeat;

      if (age > this.STALE_THRESHOLD_MS) {
        staleSessions.push(sessionId);
      }
    }

    // Then clean them up one by one to avoid race conditions
    for (const sessionId of staleSessions) {
      const slotInfo = this.sessionSlots.get(sessionId);
      if (slotInfo) {
        console.warn(
          `[ConcurrencyManager] Cleaning up stale slot: ${sessionId} (age: ${Math.round((now - slotInfo.lastHeartbeat.getTime()) / 1000)}s, active requests: ${slotInfo.activeRequests})`
        );
        await this.releaseAllSlots(sessionId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(
        `[ConcurrencyManager] Cleaned up ${cleanedCount} stale slot(s)`
      );
    }
  }

  /**
   * Get concurrency statistics
   * @returns Concurrency stats object
   */
  getConcurrencyStats(): {
    totalSlots: number;
    usedSlots: number;
    availableSlots: number;
    byAccount: Array<{ accountId: string; used: number; max: number }>;
  } {
    const accounts = this.poolManager.getAllAccounts();

    let totalSlots = 0;
    let usedSlots = 0;
    const byAccount: Array<{
      accountId: string;
      used: number;
      max: number;
    }> = [];

    for (const account of accounts) {
      totalSlots += account.concurrency.max;
      usedSlots += account.concurrency.current;
      byAccount.push({
        accountId: account.id,
        used: account.concurrency.current,
        max: account.concurrency.max,
      });
    }

    return {
      totalSlots,
      usedSlots,
      availableSlots: totalSlots - usedSlots,
      byAccount,
    };
  }

  /**
   * Get active session count
   * @returns Number of active sessions
   */
  getActiveSessionCount(): number {
    return this.sessionSlots.size;
  }

  /**
   * Get session info by ID
   * @param sessionId - Session ID
   * @returns Session slot info or undefined
   */
  getSessionInfo(sessionId: string): SessionSlotInfo | undefined {
    return this.sessionSlots.get(sessionId);
  }

  /**
   * Force release a slot (for admin/emergency use)
   * @param sessionId - Session ID to force release
   */
  forceReleaseSlot(sessionId: string): void {
    const slotInfo = this.sessionSlots.get(sessionId);
    if (slotInfo) {
      const account = this.poolManager.getAccount(slotInfo.accountId);
      if (account) {
        account.concurrency.slots?.delete(sessionId);
        account.concurrency.current = Math.max(
          0,
          account.concurrency.current - 1
        );
        account.concurrency.lastUpdated = new Date();
      }
      this.sessionSlots.delete(sessionId);
      console.log(
        `[ConcurrencyManager] Force released slot: ${sessionId}`
      );
    }
  }

  /**
   * Reset all concurrency slots (for admin use when slots leak)
   * Clears all session tracking and resets all account concurrency counters to 0
   */
  resetAllSlots(): void {
    // Reset all account concurrency counters
    const accounts = this.poolManager.getAllAccounts();
    for (const account of accounts) {
      account.concurrency.current = 0;
      account.concurrency.slots?.clear();
      account.concurrency.lastUpdated = new Date();
    }

    // Clear all session tracking
    const count = this.sessionSlots.size;
    this.sessionSlots.clear();

    console.log(
      `[ConcurrencyManager] Reset all slots: cleared ${count} session(s)`
    );
  }
}
