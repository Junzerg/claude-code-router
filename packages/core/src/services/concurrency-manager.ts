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
  /** Number of active concurrent requests sharing this slot */
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
    const slotKey = `${sessionId}:${accountId}`;
    const slotInfo = this.sessionSlots.get(slotKey);
    if (slotInfo && account.concurrency.slots?.has(sessionId)) {
      console.debug(
        `[ConcurrencyManager] Session ${sessionId} already has slot on account ${accountId}, incrementing active requests`
      );
      // Update heartbeat and increment reference count
      slotInfo.lastHeartbeat = new Date();
      slotInfo.activeRequests += 1;
      this.sessionSlots.set(slotKey, slotInfo);
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

    // Track session slot
    this.sessionSlots.set(slotKey, {
      accountId,
      acquiredAt: new Date(),
      lastHeartbeat: new Date(),
      activeRequests: 1,
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

    const slotKey = `${sessionId}:${accountId}`;
    const slotInfo = this.sessionSlots.get(slotKey);
    if (slotInfo) {
      slotInfo.activeRequests = Math.max(0, slotInfo.activeRequests - 1);
      if (slotInfo.activeRequests > 0) {
        console.debug(
          `[ConcurrencyManager] Session ${sessionId} released a request but still has ${slotInfo.activeRequests} active request(s)`
        );
        this.sessionSlots.set(slotKey, slotInfo);
        return;
      }
    }

    if (account.concurrency.slots?.has(sessionId)) {
      account.concurrency.slots.delete(sessionId);
      account.concurrency.current = Math.max(
        0,
        account.concurrency.current - 1
      );
      account.concurrency.lastUpdated = new Date();

      console.log(
        `[ConcurrencyManager] Slot completely released: ${sessionId} <- ${accountId} (${account.concurrency.current}/${account.concurrency.max})`
      );
    }

    // Remove session tracking
    this.sessionSlots.delete(slotKey);
  }

  /**
   * Release all slots for a session (called when user disconnects)
   * @param sessionId - Session ID to release all slots for
   */
  async releaseAllSlots(sessionId: string): Promise<void> {
    // Iterate over all entries to find slots matching this sessionId
    for (const [slotKey, slotInfo] of Array.from(this.sessionSlots.entries())) {
      if (slotKey.startsWith(`${sessionId}:`)) {
        // Force activeRequests to 1 so the next releaseSlot completely frees it
        slotInfo.activeRequests = 1;
        this.sessionSlots.set(slotKey, slotInfo);
        
        await this.releaseSlot(slotInfo.accountId, sessionId);
        console.log(
          `[ConcurrencyManager] All slots forcedly released for session: ${sessionId} on account ${slotInfo.accountId}`
        );
      }
    }
  }

  /**
   * Get the account ID for a session
   * @param sessionId - Session ID
   * @returns Account ID or undefined if not found
   */
  getSessionAccount(sessionId: string): string | undefined {
    // Find the first account associated with this session (legacy fallback)
    for (const [slotKey, slotInfo] of this.sessionSlots.entries()) {
      if (slotKey.startsWith(`${sessionId}:`)) {
        return slotInfo.accountId;
      }
    }
    return undefined;
  }

  /**
   * Check if a session has an active slot
   * @param sessionId - Session ID
   * @returns True if session has active slot
   */
  hasActiveSlot(sessionId: string): boolean {
    for (const slotKey of this.sessionSlots.keys()) {
      if (slotKey.startsWith(`${sessionId}:`)) return true;
    }
    return false;
  }

  /**
   * Check if a session is still active (has heartbeat recently)
   * @param sessionId - Session ID
   * @returns True if session is active
   */
  isSessionActive(sessionId: string): boolean {
    const now = Date.now();
    for (const [slotKey, slotInfo] of this.sessionSlots.entries()) {
      if (slotKey.startsWith(`${sessionId}:`)) {
        const lastHeartbeat = slotInfo.lastHeartbeat.getTime();
        if (now - lastHeartbeat < this.STALE_THRESHOLD_MS) {
          return true;
        }
      }
    }
    return false;
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

    for (const [slotKey, slotInfo] of Array.from(this.sessionSlots.entries())) {
      const lastHeartbeat = slotInfo.lastHeartbeat.getTime();
      const age = now - lastHeartbeat;

      if (age > this.STALE_THRESHOLD_MS) {
        // Extract sessionId from slotKey
        const sessionId = slotKey.split(':')[0];
        console.warn(
          `[ConcurrencyManager] Cleaning up stale slot: ${sessionId} (age: ${Math.round((now - slotInfo.lastHeartbeat.getTime()) / 1000)}s, active requests: ${slotInfo.activeRequests})`
        );
        // Use releaseAllSlots to ensure complete cleanup regardless of active request count
        this.releaseAllSlots(sessionId);
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
    for (const [slotKey, slotInfo] of this.sessionSlots.entries()) {
      if (slotKey.startsWith(`${sessionId}:`)) return slotInfo;
    }
    return undefined;
  }

  /**
   * Force release a slot (for admin/emergency use)
   * @param sessionId - Session ID to force release
   */
  forceReleaseSlot(sessionId: string): void {
    const keysToRemove: string[] = [];
    for (const [slotKey, slotInfo] of this.sessionSlots.entries()) {
      if (slotKey.startsWith(`${sessionId}:`)) {
        const account = this.poolManager.getAccount(slotInfo.accountId);
        if (account) {
          account.concurrency.slots?.delete(sessionId);
          account.concurrency.current = Math.max(
            0,
            account.concurrency.current - 1
          );
          account.concurrency.lastUpdated = new Date();
        }
        keysToRemove.push(slotKey);
      }
    }
    for (const key of keysToRemove) {
      this.sessionSlots.delete(key);
    }
    if (keysToRemove.length > 0) {
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
