# Task 2.6-2.7: 本地统计与 CLI

**优先级**: P1
**预计时间**: 3 小时 (合计)
**依赖**: Phase 1 完成

---

## Task 2.6: 本地用量统计

### 文件位置
`packages/core/src/services/usage-tracker.ts`

### 功能说明

由于 Z.ai API 可能有调用频率限制，或者 API 返回的数据不够实时，我们需要在本地统计请求计数，作为 API 数据的补充。

### 核心功能

```typescript
/**
 * 本地用量追踪器
 *
 * 功能:
 * - 统计每个账号的请求次数
 * - 统计 token 使用量 (估算)
 * - 提供用量查询接口
 */
export class UsageTracker {
  private stats: Map<string, AccountUsageStats>;
  private cleanupInterval?: NodeJS.Timeout;

  /**
   * 记录请求
   */
  recordRequest(accountId: string, options: {
    estimatedTokens?: number;
    model?: string;
  }): void;

  /**
   * 获取账号用量统计
   */
  getStats(accountId: string): AccountUsageStats | undefined;

  /**
   * 获取最近 5 小时用量
   */
  getLast5Hours(accountId: string): number;

  /**
   * 获取本周用量
   */
  getWeekly(accountId: string): number;

  /**
   * 重置统计 (定时调用)
   */
  resetStats(): void;
}

/**
 * 账号用量统计
 */
interface AccountUsageStats {
  /** 请求时间戳 -> token 数 */
  requests: Map<number, number>;
  /** 最近 5 小时请求数 */
  last5Hours: number;
  /** 本周请求数 */
  weekly: number;
  /** 最后更新时间 */
  lastUpdated: Date;
}
```

### 实现

```typescript
export class UsageTracker {
  private stats: Map<string, AccountUsageStats> = new Map();

  /**
   * 记录请求
   */
  recordRequest(accountId: string, options: {
    estimatedTokens?: number;
    model?: string;
  } = {}): void {
    let accountStats = this.stats.get(accountId);

    if (!accountStats) {
      accountStats = {
        requests: new Map(),
        last5Hours: 0,
        weekly: 0,
        lastUpdated: new Date(),
      };
      this.stats.set(accountId, accountStats);
    }

    const now = Date.now();
    const tokens = options.estimatedTokens || 1000; // 默认估算 1000 tokens

    // 记录请求
    accountStats.requests.set(now, tokens);

    // 更新统计
    this.updateCounts(accountStats);
  }

  /**
   * 更新计数
   */
  private updateCounts(stats: AccountUsageStats): void {
    const now = Date.now();
    const fiveHoursAgo = now - 5 * 60 * 60 * 1000;
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

    let last5Hours = 0;
    let weekly = 0;

    // 清理过期数据并统计
    for (const [timestamp, tokens] of stats.requests.entries()) {
      if (timestamp > fiveHoursAgo) {
        last5Hours += tokens;
      }
      if (timestamp > weekAgo) {
        weekly += tokens;
      }
      // 删除超过一周的数据
      if (timestamp <= weekAgo) {
        stats.requests.delete(timestamp);
      }
    }

    stats.last5Hours = last5Hours;
    stats.weekly = weekly;
    stats.lastUpdated = new Date();
  }

  /**
   * 获取最近 5 小时用量
   */
  getLast5Hours(accountId: string): number {
    const stats = this.stats.get(accountId);
    return stats?.last5Hours || 0;
  }

  /**
   * 获取本周用量
   */
  getWeekly(accountId: string): number {
    const stats = this.stats.get(accountId);
    return stats?.weekly || 0;
  }

  /**
   * 重置统计 (每周调用一次)
   */
  resetStats(): void {
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

    for (const stats of this.stats.values()) {
      // 只保留最近一周的数据
      for (const timestamp of stats.requests.keys()) {
        if (timestamp <= weekAgo) {
          stats.requests.delete(timestamp);
        }
      }
      this.updateCounts(stats);
    }
  }
}
```

### 与 PoolManager 集成

```typescript
// 在 PoolManager 中添加 UsageTracker
export class PoolManager {
  private usageTracker: UsageTracker;

  constructor() {
    this.usageTracker = new UsageTracker();

    // 每周重置一次统计
    setInterval(() => {
      this.usageTracker.resetStats();
    }, 7 * 24 * 60 * 60 * 1000);
  }

  /**
   * 记录请求 (公开方法)
   */
  recordRequest(accountId: string, options?: {
    estimatedTokens?: number;
  }): void {
    this.usageTracker.recordRequest(accountId, options);
  }

  /**
   * 获取账号用量 (重写 getAccount)
   */
  getAccount(accountId: string): CodingPlanAccount | undefined {
    const account = this.accounts.get(accountId);
    if (!account) return undefined;

    // 用本地统计更新用量数据
    account.usage.last5Hours = this.usageTracker.getLast5Hours(accountId);
    account.usage.weekly = this.usageTracker.getWeekly(accountId);

    return account;
  }
}
```

---

## Task 2.7: CLI - ccr pool binding

### 文件位置
`packages/cli/src/commands/pool-binding.ts`

### 命令格式

```bash
ccr pool binding [options]
```

### 选项

| 选项 | 简写 | 说明 |
|------|------|------|
| `--list` | `-l` | 列出所有绑定 |
| `--clear` | `-c` | 清除所有绑定 |
| `--remove` | `-r` | 移除指定会话的绑定 |
| `--session` | `-s` | 会话 ID (与 --remove 配合使用) |

### 使用示例

```bash
# 列出所有会话绑定
ccr pool binding --list

# 清除所有绑定
ccr pool binding --clear

# 移除指定会话的绑定
ccr pool binding --remove --session session_abc123
```

### 输出示例

```
会话绑定列表
─────────────────────────────────────────
会话 ID                      账号 ID          创建时间             最后活跃
conv_abc123                  cp-1710000001    2026-03-09 10:00    10 分钟前
session_def456               cp-1710000002    2026-03-09 09:30    25 分钟前

总计：2 个绑定
```

### 核心实现

```typescript
import { Command } from 'commander';
import { SessionBinder } from '@CCR/core';

const poolBindingCommand = new Command('binding')
  .description('管理会话绑定')
  .option('-l, --list', '列出所有绑定')
  .option('-c, --clear', '清除所有绑定')
  .option('-r, --remove', '移除指定会话的绑定')
  .option('-s, --session <string>', '会话 ID')
  .action(async (options) => {
    const binder = SessionBinder.getInstance();

    if (options.list) {
      listBindings(binder);
    } else if (options.clear) {
      clearBindings(binder);
    } else if (options.remove && options.session) {
      removeBinding(binder, options.session);
    } else {
      // 默认显示列表
      listBindings(binder);
    }
  });

function listBindings(binder: SessionBinder) {
  const bindings = binder.getAllBindings();

  if (bindings.length === 0) {
    console.log('没有活跃的绑定');
    return;
  }

  console.log('\n会话绑定列表');
  console.log('─'.repeat(60));

  console.table(bindings.map(b => ({
    '会话 ID': b.sessionId,
    '账号 ID': b.accountId,
    '创建时间': formatTime(b.createdAt),
    '最后活跃': formatTime(b.lastActiveAt),
  })));

  console.log(`\n总计：${bindings.length} 个绑定`);
}

function clearBindings(binder: SessionBinder) {
  const bindings = binder.getAllBindings();
  if (bindings.length === 0) {
    console.log('没有活跃的绑定');
    return;
  }

  for (const binding of bindings) {
    binder.unbind(binding.sessionId);
  }

  console.log(`已清除 ${bindings.length} 个绑定`);
}
```

---

## 验收标准

### UsageTracker
- [x] 正确记录每次请求 ✅
- [x] 5 小时统计准确 ✅
- [x] 周统计准确 ✅
- [x] 过期数据自动清理 ✅

### pool binding CLI
- [x] 列出所有绑定 ✅
- [x] 清除所有绑定 ✅
- [x] 移除指定会话绑定 ✅

**Task 2.6 完成时间**: 2026-03-10
**Task 2.7 完成时间**: 2026-03-10
**状态**: ✅ 已完成

---

## 实现总结

### Task 2.6: 本地用量统计

**新增文件**:
- `packages/core/src/services/usage-tracker.ts` - 本地用量追踪器

**核心功能**:
- `recordRequest(accountId, options)` - 记录请求及 token 数
- `getStats(accountId)` - 获取账号用量统计
- `getLast5Hours(accountId)` - 获取最近 5 小时用量
- `getWeekly(accountId)` - 获取本周用量
- `getTotalUsage()` - 获取总用量统计
- `resetStats()` - 重置统计（清理过期数据）

**PoolManager 集成**:
- `recordRequest(accountId, options)` - 记录请求（代理到 UsageTracker）
- `getAccount(accountId)` - 获取账号（自动更新用量统计）
- `getAllAccounts()` - 获取所有账号（自动更新用量统计）
- `getUsageTracker()` - 获取 UsageTracker 实例

### Task 2.7: CLI binding 管理

**新增文件**:
- `packages/cli/src/commands/pool-binding.ts` - CLI binding 管理命令
- `packages/core/src/api/routes.ts` - Pool binding API 端点

**CLI 命令**:
```bash
# 列出所有会话绑定
ccr pool binding --list

# 清除所有绑定
ccr pool binding --clear

# 移除指定会话的绑定
ccr pool binding --remove --session conv_abc123

# JSON 格式输出
ccr pool binding --json
```

**API 端点**:
- `GET /api/pool/bindings` - 获取绑定列表和统计
- `POST /api/pool/bindings/clear` - 清除所有绑定
- `POST /api/pool/bindings/remove?sessionId=xxx` - 移除指定绑定

**输出示例**:
```
═══════════════════════════════════════════════
        Z.ai Coding Plan Session Bindings
═══════════════════════════════════════════════

┌──────────────────────────────┬─────────────────┬──────────────┬─────────────┐
│ 会话 ID                      │ 账号 ID         │ 创建时间     │ 最后活跃    │
├──────────────────────────────┼─────────────────┼──────────────┼─────────────┤
│ conv_abc123def456ghi789jk    │ cp-1710000001   │ 03-10 10:00  │ 5 分钟前     │
│ session_xyz789abc123def45    │ cp-1710000002   │ 03-10 09:30  │ 25 分钟前    │
└──────────────────────────────┴─────────────────┴──────────────┴─────────────┘

绑定统计
────────────────────────────────────────
总绑定数：2
TTL: 60 分钟
受限解除：启用
自动清理：运行中
```

---

## 相关文件

- [Phase 2 计划](./README.md)
- [Phase 1 完成](../phase1/README.md)
- [主计划](../coding-plan-pool-implementation-plan.md)
