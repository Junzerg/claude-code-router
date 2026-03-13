import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ConcurrencyManager } from '../src/services/concurrency-manager';
import { PoolManager } from '../src/services/pool-manager';
import { CodingPlanAccount } from '../src/types/pool';

describe('ConcurrencyManager', () => {
  let poolManager: PoolManager;
  let concurrencyManager: ConcurrencyManager;
  let account: CodingPlanAccount;

  beforeEach(() => {
    vi.useFakeTimers();
    poolManager = new PoolManager({ defaultMaxConcurrency: 2 });
    concurrencyManager = new ConcurrencyManager(poolManager);

    account = poolManager.addAccount({
      name: 'Test Account',
      platform: 'zai',
      apiKey: 'key',
      apiBaseUrl: 'url',
      maxConcurrency: 2,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Slot Acquisition', () => {
    it('should successfully acquire a slot if under max concurrency', async () => {
      const success = await concurrencyManager.acquireSlot(account.id, 'session-1');
      expect(success).toBe(true);
      expect(account.concurrency.current).toBe(1);
      expect(account.concurrency.slots?.has('session-1')).toBe(true);
      expect(concurrencyManager.hasActiveSlot('session-1')).toBe(true);
    });

    it('should fail to acquire a slot if account does not exist', async () => {
      const success = await concurrencyManager.acquireSlot('invalid-id', 'session-1');
      expect(success).toBe(false);
    });

    it('should fail to acquire a slot if at max concurrency', async () => {
      await concurrencyManager.acquireSlot(account.id, 'session-1');
      await concurrencyManager.acquireSlot(account.id, 'session-2');
      
      const success = await concurrencyManager.acquireSlot(account.id, 'session-3');
      expect(success).toBe(false);
      expect(account.concurrency.current).toBe(2);
    });

    it('should update heartbeat if same session requests slot again', async () => {
      await concurrencyManager.acquireSlot(account.id, 'session-1');
      
      const initialSlotInfo = concurrencyManager.getSessionInfo('session-1');
      const initialHeartbeat = initialSlotInfo?.lastHeartbeat.getTime();
      
      // Advance time and re-acquire
      vi.advanceTimersByTime(1000);
      const success = await concurrencyManager.acquireSlot(account.id, 'session-1');
      
      expect(success).toBe(true);
      // Concurrency shouldn't increase
      expect(account.concurrency.current).toBe(1);
      
      const updatedSlotInfo = concurrencyManager.getSessionInfo('session-1');
      expect(updatedSlotInfo?.lastHeartbeat.getTime()).toBeGreaterThan(initialHeartbeat!);
    });
  });

  describe('Slot Release', () => {
    it('should successfully release a slot', async () => {
      await concurrencyManager.acquireSlot(account.id, 'session-1');
      expect(account.concurrency.current).toBe(1);
      
      await concurrencyManager.releaseSlot(account.id, 'session-1');
      
      expect(account.concurrency.current).toBe(0);
      expect(account.concurrency.slots?.has('session-1')).toBe(false);
      expect(concurrencyManager.hasActiveSlot('session-1')).toBe(false);
    });

    it('should release all slots for a session', async () => {
      await concurrencyManager.acquireSlot(account.id, 'session-1');
      await concurrencyManager.releaseAllSlots('session-1');
      
      expect(account.concurrency.current).toBe(0);
      expect(concurrencyManager.hasActiveSlot('session-1')).toBe(false);
    });
    
    it('should force release a slot', async () => {
      await concurrencyManager.acquireSlot(account.id, 'session-1');
      concurrencyManager.forceReleaseSlot('session-1');
      
      expect(account.concurrency.current).toBe(0);
      expect(concurrencyManager.hasActiveSlot('session-1')).toBe(false);
    });
  });

  describe('Stale Slots Cleanup', () => {
    it('should identify session as inactive if heartbeat is stale', async () => {
      await concurrencyManager.acquireSlot(account.id, 'session-1');
      expect(concurrencyManager.isSessionActive('session-1')).toBe(true);
      
      // Advance by 6 minutes (STALE_THRESHOLD is 5 minutes)
      vi.advanceTimersByTime(6 * 60 * 1000);
      
      expect(concurrencyManager.isSessionActive('session-1')).toBe(false);
    });

    it('should clean up stale slots when check is run', async () => {
      await concurrencyManager.acquireSlot(account.id, 'session-1');
      await concurrencyManager.acquireSlot(account.id, 'session-2');
      
      // Update session-2 heartbeat
      vi.advanceTimersByTime(3 * 60 * 1000);
      await concurrencyManager.acquireSlot(account.id, 'session-2'); // heartbeat
      
      // Advance another 3 minutes -> session 1 is 6m old, session 2 is 3m old
      vi.advanceTimersByTime(3 * 60 * 1000);
      
      // Start heartbeat check to trigger cleanup immediately, or manually trigger the private method.
      // We will access the private method via any casting for testing purposes
      (concurrencyManager as any).cleanupStaleSlots();
      
      expect(concurrencyManager.hasActiveSlot('session-1')).toBe(false);
      expect(concurrencyManager.hasActiveSlot('session-2')).toBe(true);
      expect(account.concurrency.current).toBe(1); // Only session-2 remains
    });
  });

  describe('Stats', () => {
    it('should calculate concurrency stats correctly', async () => {
      await concurrencyManager.acquireSlot(account.id, 'session-1');
      
      const stats = concurrencyManager.getConcurrencyStats();
      expect(stats.totalSlots).toBe(2);
      expect(stats.usedSlots).toBe(1);
      expect(stats.availableSlots).toBe(1);
      expect(stats.byAccount.length).toBe(1);
      expect(stats.byAccount[0].accountId).toBe(account.id);
      expect(stats.byAccount[0].used).toBe(1);
      expect(stats.byAccount[0].max).toBe(2);
      
      expect(concurrencyManager.getActiveSessionCount()).toBe(1);
    });
  });
});
