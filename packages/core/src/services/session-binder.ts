import { SessionBinding } from '../types/pool';

/**
 * Session Binder Options
 */
export interface SessionBinderOptions {
  /** Session TTL in minutes (default: 60) */
  ttlMinutes: number;
  /** Whether to break binding when account is limited */
  breakOnLimited: boolean;
}

/**
 * Session Binder Callback for logging
 */
export interface SessionBinderCallbacks {
  /** Called when a binding is created */
  onBind?: (sessionId: string, accountId: string) => void;
  /** Called when a binding is removed */
  onUnbind?: (sessionId: string, accountId: string) => void;
  /** Called when a binding expires */
  onExpire?: (sessionId: string, accountId: string) => void;
  /** Called when account becomes limited */
  onAccountLimited?: (accountId: string, affectedSessions: string[]) => void;
}

/**
 * Session Binder
 *
 * Manages session-to-account bindings with TTL expiration.
 *
 * Features:
 * - Session-account binding lifecycle management
 * - TTL-based expiration (default 60 minutes)
 * - Automatic cleanup of expired bindings
 * - Break bindings when account is limited
 * - Callback hooks for logging and monitoring
 *
 * Usage:
 * ```typescript
 * const binder = new SessionBinder({
 *   ttlMinutes: 60,
 *   breakOnLimited: true,
 * });
 *
 * // Create binding
 * binder.bind('session-123', 'account-456');
 *
 * // Get bound account
 * const accountId = binder.getBoundAccount('session-123');
 *
 * // Check if binding is still valid
 * const isValid = binder.isValid('session-123');
 * ```
 */
export class SessionBinder {
  private bindings: Map<string, SessionBinding>;
  private ttlMs: number;
  private breakOnLimited: boolean;
  private cleanupInterval?: NodeJS.Timeout;
  private callbacks?: SessionBinderCallbacks;

  /**
   * Create SessionBinder instance
   * @param options - Binder configuration
   * @param callbacks - Optional callback hooks
   */
  constructor(
    options: SessionBinderOptions,
    callbacks?: SessionBinderCallbacks
  ) {
    this.bindings = new Map();
    this.ttlMs = options.ttlMinutes * 60 * 1000;
    this.breakOnLimited = options.breakOnLimited;
    this.callbacks = callbacks;

    // Auto-start cleanup every 5 minutes
    this.startCleanup(5 * 60 * 1000);
  }

  /**
   * Get the account ID bound to a session
   * @param sessionId - Session ID
   * @returns Account ID or undefined if not bound or expired
   */
  getBoundAccount(sessionId: string): string | undefined {
    const binding = this.bindings.get(sessionId);
    if (!binding) {
      return undefined;
    }

    // Check if binding is still valid (not expired)
    if (!this.isValid(sessionId)) {
      this.unbind(sessionId);
      return undefined;
    }

    // Update last active time (touch)
    this.touch(sessionId);
    return binding.accountId;
  }

  /**
   * Create or update a session-account binding
   * @param sessionId - Session ID
   * @param accountId - Account ID to bind
   * @returns The created/updated binding
   */
  bind(sessionId: string, accountId: string): SessionBinding {
    const now = new Date();

    // Update existing binding
    if (this.bindings.has(sessionId)) {
      const binding = this.bindings.get(sessionId)!;
      binding.accountId = accountId;
      binding.lastActiveAt = now;
      binding.updatedAt = now;
      console.log(`[SessionBinder] Updated binding: ${sessionId} -> ${accountId}`);
      this.callbacks?.onBind?.(sessionId, accountId);
      return binding;
    }

    // Create new binding
    const binding: SessionBinding = {
      sessionId,
      accountId,
      createdAt: now,
      lastActiveAt: now,
      updatedAt: now,
      ttlMinutes: Math.floor(this.ttlMs / 60000),
    };

    this.bindings.set(sessionId, binding);
    console.log(`[SessionBinder] Created binding: ${sessionId} -> ${accountId}`);
    this.callbacks?.onBind?.(sessionId, accountId);
    return binding;
  }

  /**
   * Remove a session binding
   * @param sessionId - Session ID
   * @returns True if binding was removed, false if not found
   */
  unbind(sessionId: string): boolean {
    const binding = this.bindings.get(sessionId);
    if (binding) {
      this.bindings.delete(sessionId);
      console.log(`[SessionBinder] Removed binding: ${sessionId}`);
      this.callbacks?.onUnbind?.(sessionId, binding.accountId);
      return true;
    }
    return false;
  }

  /**
   * Update the last active time for a session
   * @param sessionId - Session ID
   */
  touch(sessionId: string): void {
    const binding = this.bindings.get(sessionId);
    if (binding) {
      binding.lastActiveAt = new Date();
    }
  }

  /**
   * Check if a session binding is still valid (not expired)
   * @param sessionId - Session ID
   * @returns True if binding exists and is not expired
   */
  isValid(sessionId: string): boolean {
    const binding = this.bindings.get(sessionId);
    if (!binding) {
      return false;
    }

    const now = Date.now();
    const lastActiveTime = binding.lastActiveAt.getTime();
    const elapsed = now - lastActiveTime;

    if (elapsed >= this.ttlMs) {
      console.log(
        `[SessionBinder] Binding expired: ${sessionId} (inactive for ${Math.floor(elapsed / 60000)} min)`
      );
      return false;
    }

    return true;
  }

  /**
   * Handle account becoming limited - break all bindings for this account
   * @param accountId - Account ID that became limited
   * @returns List of session IDs that were unbound
   */
  handleAccountLimited(accountId: string): string[] {
    if (!this.breakOnLimited) {
      console.log(
        `[SessionBinder] breakOnLimited is disabled, keeping bindings for limited account ${accountId}`
      );
      return [];
    }

    const affectedSessions: string[] = [];

    // Find all sessions bound to this account
    for (const [sessionId, binding] of this.bindings.entries()) {
      if (binding.accountId === accountId) {
        affectedSessions.push(sessionId);
      }
    }

    // Remove all affected bindings
    for (const sessionId of affectedSessions) {
      this.bindings.delete(sessionId);
      console.log(
        `[SessionBinder] Broken binding due to account limited: ${sessionId} was bound to ${accountId}`
      );
    }

    this.callbacks?.onAccountLimited?.(accountId, affectedSessions);
    return affectedSessions;
  }

  /**
   * Get all active bindings
   * @returns Array of session bindings
   */
  getAllBindings(): SessionBinding[] {
    return Array.from(this.bindings.values());
  }

  /**
   * Get binding info for a specific session
   * @param sessionId - Session ID
   * @returns Binding info or undefined
   */
  getBinding(sessionId: string): SessionBinding | undefined {
    return this.bindings.get(sessionId);
  }

  /**
   * Get the number of active bindings
   * @returns Number of bindings
   */
  getBindingCount(): number {
    return this.bindings.size;
  }

  /**
   * Clear all bindings (useful for testing or reset)
   */
  clearAllBindings(): void {
    const count = this.bindings.size;
    this.bindings.clear();
    console.log(`[SessionBinder] Cleared all ${count} bindings`);
  }

  /**
   * Start periodic cleanup of expired bindings
   * @param intervalMs - Cleanup interval in milliseconds (default: 5 minutes)
   */
  startCleanup(intervalMs: number = 5 * 60 * 1000): void {
    // Stop existing cleanup interval if any
    this.stopCleanup();

    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredBindings();
    }, intervalMs);

    console.log(
      `[SessionBinder] Started cleanup interval (every ${Math.floor(intervalMs / 60000)} min)`
    );
  }

  /**
   * Stop the periodic cleanup
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
      console.log(`[SessionBinder] Stopped cleanup interval`);
    }
  }

  /**
   * Clean up expired bindings (called internally by cleanup interval)
   * @returns Number of bindings removed
   */
  private cleanupExpiredBindings(): number {
    let removed = 0;

    for (const [sessionId, binding] of this.bindings.entries()) {
      if (!this.isValid(sessionId)) {
        this.bindings.delete(sessionId);
        removed++;
        console.log(`[SessionBinder] Cleaned up expired binding: ${sessionId}`);
      }
    }

    if (removed > 0) {
      console.log(`[SessionBinder] Cleanup removed ${removed} expired bindings`);
    }

    return removed;
  }

  /**
   * Update binder options
   * @param options - New options
   */
  setOptions(options: Partial<SessionBinderOptions>): void {
    if (options.ttlMinutes !== undefined) {
      this.ttlMs = options.ttlMinutes * 60 * 1000;
      console.log(`[SessionBinder] Updated TTL to ${options.ttlMinutes} minutes`);
    }
    if (options.breakOnLimited !== undefined) {
      this.breakOnLimited = options.breakOnLimited;
      console.log(
        `[SessionBinder] breakOnLimited set to ${options.breakOnLimited}`
      );
    }
  }

  /**
   * Get binder statistics
   * @returns Statistics object
   */
  getStats(): {
    totalBindings: number;
    ttlMinutes: number;
    breakOnLimited: boolean;
    isCleanupRunning: boolean;
  } {
    return {
      totalBindings: this.bindings.size,
      ttlMinutes: Math.floor(this.ttlMs / 60000),
      breakOnLimited: this.breakOnLimited,
      isCleanupRunning: this.cleanupInterval !== undefined,
    };
  }
}
