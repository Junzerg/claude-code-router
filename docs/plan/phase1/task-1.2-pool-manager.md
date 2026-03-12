# Task 1.2: 实现 AccountPool 管理类

**优先级**: P0
**预计时间**: 2 小时
**依赖**: Task 1.1 (类型定义)

---

## 目标

实现账号池的核心管理类，负责账号的增删改查和状态管理。

---

## 开发内容

### 文件位置
`packages/core/src/services/pool-manager.ts`

### 核心功能

```typescript
import { CodingPlanAccount, AccountPoolConfig } from '../types/pool';

/**
 * 账号池管理器
 *
 * 功能:
 * - 账号的增删改查
 * - 账号状态管理
 * - 内存级数据存储
 */
export class PoolManager {
  private accounts: Map<string, CodingPlanAccount>;
  private config: AccountPoolConfig;

  constructor(config?: Partial<AccountPoolConfig>);

  /**
   * 添加账号
   */
  addAccount(account: Omit<CodingPlanAccount, 'status' | 'concurrency' | 'usage' | 'metadata'>): CodingPlanAccount;

  /**
   * 删除账号
   */
  removeAccount(accountId: string): boolean;

  /**
   * 获取账号
   */
  getAccount(accountId: string): CodingPlanAccount | undefined;

  /**
   * 获取所有账号
   */
  getAllAccounts(): CodingPlanAccount[];

  /**
   * 获取可用账号列表
   */
  getAvailableAccounts(): CodingPlanAccount[];

  /**
   * 更新账号信息
   */
  updateAccount(accountId: string, updates: Partial<CodingPlanAccount>): CodingPlanAccount;

  /**
   * 检查账号是否可用
   */
  isAccountAvailable(accountId: string): boolean;

  /**
   * 获取账号池状态
   */
  getPoolStatus(): {
    total: number;
    active: number;
    limited: number;
    error: number;
    totalConcurrency: number;
    availableConcurrency: number;
  };

  /**
   * 导出配置 (用于持久化)
   */
  exportConfig(): object;

  /**
   * 导入配置
   */
  importConfig(config: object): void;
}
```

### 关键实现细节

#### 1. 账号 ID 生成
```typescript
function generateAccountId(): string {
  return `cp-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
}
```

#### 2. 账号可用性检查
```typescript
isAccountAvailable(account: CodingPlanAccount): boolean {
  // 检查账号状态
  if (account.status !== 'active') return false;

  // 检查并发数
  if (account.concurrency.current >= account.concurrency.max) return false;

  // 检查 5 小时用量 (保留缓冲)
  const bufferRatio = account.config.bufferRatio || 0.1;
  const usageRatio = account.usage.last5Hours / account.config.last5HoursLimit;
  if (usageRatio > 1 - bufferRatio) return false;

  // 检查周用量
  const weeklyRatio = account.usage.weekly / account.config.weeklyLimit;
  if (weeklyRatio > 1 - bufferRatio) return false;

  return true;
}
```

---

## 验收标准

- [x] 可以成功添加账号
- [x] 可以删除账号
- [x] 可以查询账号列表
- [x] 可用性检查逻辑正确
- [x] 单元测试通过

**完成时间**: 2026-03-09
**状态**: ✅ 已完成

---

## 实现说明

实际实现包含的功能：

### 核心功能
1. **CRUD 操作**: `addAccount`, `removeAccount`, `getAccount`, `getAllAccounts`, `updateAccount`
2. **可用性检查**:
   - `isAccountAvailable(account)` - 传入账号对象
   - `isAccountAvailableById(accountId)` - 传入账号 ID
   - `getAvailableAccounts()` - 获取可用账号列表
3. **状态管理**:
   - `setAccountStatus()` - 设置账号状态
   - `markAccountLimited()` - 标记账号受限
   - `recoverAccount()` - 恢复账号
4. **用量更新**: `updateAccountUsage()`
5. **状态汇总**: `getPoolStatus()` - 返回 PoolStatusSummary
6. **持久化**: `exportConfig()`, `importConfig()` - 支持配置导出/导入
7. **配置获取**: `getConfig()` - 获取当前配置

### 与设计文档的差异

| 设计 | 实现 | 说明 |
|------|------|------|
| `isAccountAvailable(accountId: string)` | `isAccountAvailable(account: CodingPlanAccount)` | 传入对象而非 ID，额外提供 `isAccountAvailableById()` 方法 |
| - | `markAccountLimited()` | 额外实现受限标记功能 |
| - | `recoverAccount()` | 额外实现账号恢复功能 |
| - | `setAccountStatus()` | 额外实现状态设置功能 |
| - | `updateAccountUsage()` | 额外实现用量更新功能 |

---

## 相关文件

- [Task 1.1 类型定义](./task-1.1-types.md)
- [Phase 1 计划](./README.md)
- [主计划](../coding-plan-pool-implementation-plan.md)
