import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PoolManager } from '../src/services/pool-manager';
import { CodingPlanAccount } from '../src/types/pool';

describe('PoolManager', () => {
  let poolManager: PoolManager;
  let saveCallback: () => void;

  beforeEach(() => {
    saveCallback = vi.fn();
    poolManager = new PoolManager({ defaultMaxConcurrency: 2, bufferRatio: 0.1 }, saveCallback);
  });

  describe('Account CRUD', () => {
    it('should add a new account, auto-generating id and preserving metadata', () => {
      const accountData = {
        name: 'Test Account 1',
        platform: 'zai' as const,
        apiKey: 'sk-test1234',
        apiBaseUrl: 'https://api.test.com',
      };

      const account = poolManager.addAccount(accountData);

      expect(account).toBeDefined();
      expect(account.id).toMatch(/^cp-\d+-/);
      expect(account.name).toBe('Test Account 1');
      expect(account.status).toBe('active');
      expect(account.concurrency.max).toBe(2); // From default config
      expect(account.usage.last5HoursLimit).toBe(100000); // Default placeholder
      expect(saveCallback).toHaveBeenCalledTimes(1);
    });

    it('should remove an existing account', () => {
      const account = poolManager.addAccount({
        name: 'To Remove',
        platform: 'zhipu',
        apiKey: 'test-key',
        apiBaseUrl: 'https://api.test.com',
      });

      expect(poolManager.getAllAccounts().length).toBe(1);
      
      const removed = poolManager.removeAccount(account.id);
      
      expect(removed).toBe(true);
      expect(poolManager.getAllAccounts().length).toBe(0);
      expect(saveCallback).toHaveBeenCalledTimes(2); // add + remove
    });

    it('should update account details', () => {
      const account = poolManager.addAccount({
        name: 'To Update',
        platform: 'zai',
        apiKey: 'key',
        apiBaseUrl: 'url',
      });

      const updated = poolManager.updateAccount(account.id, {
        name: 'Updated Name',
        status: 'disabled'
      });

      expect(updated.name).toBe('Updated Name');
      expect(updated.status).toBe('disabled');
      const retrieved = poolManager.getAccount(account.id);
      expect(retrieved?.name).toBe('Updated Name');
      expect(saveCallback).toHaveBeenCalledTimes(2);
    });
  });

  describe('Account Status and Limits', () => {
    let account: CodingPlanAccount;

    beforeEach(() => {
      account = poolManager.addAccount({
        name: 'Status Test',
        platform: 'zai',
        apiKey: 'key',
        apiBaseUrl: 'url',
      });
    });

    it('should mark account as limited', () => {
      poolManager.markAccountLimited(account.id, 'rate_limit', 'Too many requests');
      
      const limitedAccount = poolManager.getAccount(account.id)!;
      expect(limitedAccount.status).toBe('limited');
      expect(limitedAccount.limitedInfo?.reason).toBe('rate_limit');
      expect(limitedAccount.limitedInfo?.errorMessage).toBe('Too many requests');
    });

    it('should recover a limited account', () => {
      poolManager.markAccountLimited(account.id, 'quota_exhausted');
      poolManager.recoverAccount(account.id);
      
      const recoveredAccount = poolManager.getAccount(account.id)!;
      expect(recoveredAccount.status).toBe('active');
      expect(recoveredAccount.limitedInfo).toBeUndefined();
    });

    it('should update account usage logic correctly taking from usage tracker', () => {
      // Simulate API usage update
      poolManager.updateAccountUsage(account.id, {
        last5Hours: 50000,
        weekly: 150000
      });

      const updated = poolManager.getAccount(account.id)!;
      expect(updated.usage.last5Hours).toBe(50000);
      expect(updated.usage.weekly).toBe(150000);
    });
  });

  describe('Availability Checking', () => {
    let account: CodingPlanAccount;

    beforeEach(() => {
      account = poolManager.addAccount({
        name: 'Avail Test',
        platform: 'zai',
        apiKey: 'key',
        apiBaseUrl: 'url',
        maxConcurrency: 2,
        bufferRatio: 0.1, // Means max allowed usage is 90%
        last5HoursLimit: 100000,
        weeklyLimit: 500000
      });
    });

    it('should be available initially', () => {
      expect(poolManager.isAccountAvailable(account)).toBe(true);
    });

    it('should not be available if not active', () => {
      poolManager.setAccountStatus(account.id, 'disabled');
      // Must re-fetch or use the updated reference, wait PoolManager mutates in-place
      expect(poolManager.isAccountAvailable(account)).toBe(false);
    });

    it('should not be available if concurrency is full', () => {
      account.concurrency.current = 2; // max is 2
      expect(poolManager.isAccountAvailable(account)).toBe(false);
    });

    it('should not be available if 5-hour usage exceeds limit - buffer', () => {
      // Limit is 100,000, buffer is 0.1 -> Allowed up to 90,000
      account.usage.last5Hours = 90001; 
      expect(poolManager.isAccountAvailable(account)).toBe(false);
      
      account.usage.last5Hours = 90000;
      expect(poolManager.isAccountAvailable(account)).toBe(true);
    });

    it('should not be available if weekly usage exceeds limit - buffer', () => {
      // Limit is 500,000, buffer is 0.1 -> Allowed up to 450,000
      account.usage.weekly = 450001;
      expect(poolManager.isAccountAvailable(account)).toBe(false);
      
      account.usage.weekly = 450000;
      expect(poolManager.isAccountAvailable(account)).toBe(true);
    });
  });
});
