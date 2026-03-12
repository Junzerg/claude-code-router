# Task 1.1: 定义 CodingPlanAccount 接口

**优先级**: P0
**预计时间**: 0.5 小时
**依赖**: 无

---

## 目标

定义账号池管理所需的 TypeScript 类型和接口。

---

## 开发内容

### 文件位置
`packages/core/src/types/pool.ts`

### 接口定义

```typescript
/**
 * 账号状态
 */
export type AccountStatus = 'active' | 'limited' | 'error' | 'disabled';

/**
 * 并发状态
 */
export interface ConcurrencyState {
  /** 当前并发数 */
  current: number;
  /** 最大并发数 (默认 3) */
  max: number;
  /** 占用槽位的会话 ID */
  slots: Set<string>;
}

/**
 * 用量状态
 */
export interface UsageState {
  /** 近 5 小时请求数 (本地统计) */
  last5Hours: number;
  /** 5 小时限额 */
  last5HoursLimit: number;
  /** 本周请求数 (本地统计) */
  weekly: number;
  /** 周限额 */
  weeklyLimit: number;
  /** 用量最后更新时间 */
  lastUpdated: Date;
  /** 5 小时用量百分比 (从 API 获取) */
  last5HoursPercentage?: number;
  /** 周用量百分比 (从 API 获取) */
  weeklyPercentage?: number;
}

/**
 * 会话绑定信息
 */
export interface SessionBinding {
  /** 会话 ID */
  sessionId: string;
  /** 最后活跃时间 */
  lastActiveAt: Date;
  /** 绑定创建时间 */
  createdAt: Date;
  /** 绑定的账号 ID */
  accountId: string;
}

/**
 * 账号受限信息
 */
export interface LimitedInfo {
  /** 受限原因 */
  reason: string;
  /** 受限时间 */
  time: Date;
  /** 错误详情 */
  details?: string;
  /** 预计恢复时间 */
  recoverAt?: Date;
}

/**
 * Z.ai Coding Plan 账号配置
 */
export interface CodingPlanAccount {
  /** 账号唯一标识 */
  id: string;
  /** 账号名称/备注 */
  name: string;
  /** API Key */
  apiKey: string;
  /** 账号状态 */
  status: AccountStatus;
  /** 所属平台 (z.ai / bigmodel.cn) */
  platform: 'zai' | 'zhipu';
  /** API 基础 URL */
  apiBaseUrl: string;

  // 并发状态
  concurrency: ConcurrencyState;

  // 用量状态
  usage: UsageState;

  // 受限信息 (可选)
  limitedInfo?: LimitedInfo;

  // 配置项
  config: {
    /** 最大并发数 (默认 3) */
    maxConcurrency: number;
    /** 5 小时用量限制 */
    last5HoursLimit: number;
    /** 周用量限制 */
    weeklyLimit: number;
    /** 缓冲比例 (默认 0.1 = 10%) */
    bufferRatio: number;
  };

  // 元数据
  metadata: {
    /** 创建时间 */
    createdAt: Date;
    /** 最后修改时间 */
    updatedAt: Date;
    /** 最后使用时间 */
    lastUsedAt?: Date;
  };
}

/**
 * 账号池配置
 */
export interface AccountPoolConfig {
  /** 是否启用账号池 */
  enabled: boolean;
  /** 存储类型 */
  storage: 'memory' | 'file' | 'redis';
  /** 默认最大并发数 */
  defaultMaxConcurrency: number;
  /** 默认用量限制 */
  defaultUsageLimits: {
    last5Hours: number;
    weekly: number;
  };
  /** 缓冲比例 */
  bufferRatio: number;
  /** 会话绑定配置 */
  sessionBinding: {
    enabled: boolean;
    ttlMinutes: number;
    breakOnLimited: boolean;
  };
  /** 错误恢复配置 */
  errorRecovery: {
    maxRetries: number;
    retryDelayMs: number;
  };
  /** 用量同步配置 */
  usageSync: {
    enabled: boolean;
    intervalMinutes: number;
  };
}
```

---

## 验收标准

- [x] 类型定义完整，无 TypeScript 错误
- [x] 导出所有必要的接口和类型
- [x] 添加必要的 JSDoc 注释

**完成时间**: 2026-03-09
**状态**: ✅ 已完成

---

## 实现说明

实际实现与设计的差异：

1. **ConcurrencyState**: 移除了 `slots: Set<string>`（简化设计，不需要跟踪具体会话 ID），添加了 `lastUpdated: Date`
2. **UsageState**: 移除了百分比字段（这些可以从 API 动态计算），添加了 `lastSyncedAt`
3. **CodingPlanAccount**: 将 `config` 字段拆分合并到 `usage` 和其他顶级字段，简化访问
4. **LimitedInfo**: 使用更规范的 `since` 和 `reason` 字段
5. **额外导出**: 添加了 `AccountSelectionResult` 和 `PoolStatusSummary` 供后续使用

---

## 相关文件

- [Phase 1 计划](./README.md)
- [主计划](../coding-plan-pool-implementation-plan.md)
