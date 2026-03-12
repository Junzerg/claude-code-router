# Task 1.3: 实现并发槽位管理

**优先级**: P0
**预计时间**: 2 小时
**依赖**: Task 1.2 (PoolManager)

---

## 目标

实现并发槽位的获取、释放和清理机制。

---

## 开发内容

### 文件位置
`packages/core/src/services/concurrency-manager.ts`

### 核心功能

```typescript
import { CodingPlanAccount } from '../types/pool';
import { PoolManager } from './pool-manager';

/**
 * 并发管理器
 *
 * 功能:
 * - 并发槽位的获取和释放
 * - SSE 连接断开检测
 * - 僵尸连接清理
 */
export class ConcurrencyManager {
  private poolManager: PoolManager;
  private heartbeatCheckInterval?: NodeJS.Timeout;

  constructor(poolManager: PoolManager);

  /**
   * 获取并发槽位
   * @returns 是否成功获取
   */
  acquireSlot(accountId: string, sessionId: string): Promise<boolean>;

  /**
   * 释放并发槽位
   */
  releaseSlot(accountId: string, sessionId: string): Promise<void>;

  /**
   * 释放会话的所有槽位 (用户断开时调用)
   */
  releaseAllSlots(sessionId: string): Promise<void>;

  /**
   * 获取会话占用的账号
   */
  getSessionAccount(sessionId: string): string | undefined;

  /**
   * 启动心跳检测
   */
  startHeartbeatCheck(intervalMs?: number): void;

  /**
   * 停止心跳检测
   */
  stopHeartbeatCheck(): void;

  /**
   * 获取并发统计
   */
  getConcurrencyStats(): {
    totalSlots: number;
    usedSlots: number;
    availableSlots: number;
    byAccount: Array<{ accountId: string; used: number; max: number }>;
  };
}
```

### 关键实现细节

#### 1. 槽位获取
```typescript
async acquireSlot(accountId: string, sessionId: string): Promise<boolean> {
  const account = this.poolManager.getAccount(accountId);
  if (!account) return false;

  // 检查是否已达上限
  if (account.concurrency.current >= account.concurrency.max) {
    return false;
  }

  // 检查是否已被该会话占用
  if (account.concurrency.slots.has(sessionId)) {
    return true; // 已经占用，返回成功
  }

  // 占用槽位
  account.concurrency.current++;
  account.concurrency.slots.add(sessionId);
  account.metadata.lastUsedAt = new Date();

  return true;
}
```

#### 2. 槽位释放
```typescript
async releaseSlot(accountId: string, sessionId: string): Promise<void> {
  const account = this.poolManager.getAccount(accountId);
  if (!account) return;

  if (account.concurrency.slots.has(sessionId)) {
    account.concurrency.slots.delete(sessionId);
    account.concurrency.current = Math.max(0, account.concurrency.current - 1);
  }
}
```

#### 3. 僵尸连接清理
```typescript
private cleanupStaleSlots() {
  const now = Date.now();
  const staleThreshold = 5 * 60 * 1000; // 5 分钟

  for (const account of this.poolManager.getAllAccounts()) {
    const staleSlots: string[] = [];

    for (const sessionId of account.concurrency.slots) {
      // 检查会话是否仍然活跃
      if (!this.isSessionActive(sessionId)) {
        staleSlots.push(sessionId);
      }
    }

    // 清理僵尸槽位
    for (const sessionId of staleSlots) {
      this.releaseSlot(account.id, sessionId);
      logger.warn(`Cleaned up stale slot: ${sessionId} from account ${account.id}`);
    }
  }
}
```

---

## 验收标准

- [x] 槽位获取成功时并发数 +1
- [x] 槽位释放成功时并发数 -1
- [x] 达到并发上限时返回 false
- [x] 僵尸连接可以被清理
- [x] 单元测试通过

**完成时间**: 2026-03-09
**状态**: ✅ 已完成

---

## 实现说明

实际实现包含的功能：

### 核心功能
1. **槽位获取**: `acquireSlot(accountId, sessionId)` - 支持重复获取检测
2. **槽位释放**: `releaseSlot(accountId, sessionId)` - 释放单个槽位
3. **全部释放**: `releaseAllSlots(sessionId)` - 用户断开时释放所有槽位
4. **会话查询**: `getSessionAccount(sessionId)`, `hasActiveSlot(sessionId)`, `getSessionInfo(sessionId)`
5. **心跳检测**: `startHeartbeatCheck()`, `stopHeartbeatCheck()` - 自动清理僵尸连接
6. **统计信息**: `getConcurrencyStats()` - 返回并发统计
7. **额外功能**:
   - `isSessionActive(sessionId)` - 检查会话是否活跃
   - `getActiveSessionCount()` - 获取活跃会话数
   - `forceReleaseSlot(sessionId)` - 强制释放槽位

### 关键实现细节

1. **SessionSlotInfo 接口**: 跟踪每个会话的账号绑定、获取时间、最后心跳时间
2. **僵尸连接清理**: 5 分钟无心跳的槽位会被自动清理
3. **心跳检测**: 默认每 60 秒检查一次
4. **重复获取处理**: 同一会话重复获取同一账号的槽位会更新心跳并返回成功

---

## 相关文件

- [Task 1.2 PoolManager](./task-1.2-pool-manager.md)
- [Phase 1 计划](./README.md)
- [主计划](../coding-plan-pool-implementation-plan.md)
