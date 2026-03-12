# Task 1.8: 集成到现有路由系统

**优先级**: P0
**预计时间**: 2 小时
**依赖**: Task 1.2 (PoolManager), Task 1.3 (ConcurrencyManager)

---

## 目标

将账号池管理集成到现有的路由系统中，实现请求级别的账号选择。

---

## 开发内容

### 文件位置
- `packages/core/src/services/pool-router.ts` (新增)
- `packages/core/src/utils/router.ts` (修改)

### 核心功能

```typescript
/**
 * 账号池路由器
 *
 * 功能:
 * - 根据请求选择合适的账号
 * - 会话绑定管理
 * - 并发控制集成
 */
export class PoolRouter {
  private poolManager: PoolManager;
  private concurrencyManager: ConcurrencyManager;
  private sessionBindings: Map<string, string>; // sessionId -> accountId

  constructor(poolManager: PoolManager, concurrencyManager: ConcurrencyManager);

  /**
   * 为请求选择账号
   */
  async selectAccount(request: RequestData): Promise<AccountSelectionResult>;

  /**
   * 处理请求完成
   */
  async onRequestComplete(sessionId: string): Promise<void>;

  /**
   * 处理错误 (触发账号切换)
   */
  async handleError(sessionId: string, error: Error): Promise<AccountSelectionResult | null>;
}

/**
 * 账号选择结果
 */
export interface AccountSelectionResult {
  /** 选中的账号 ID */
  accountId: string;
  /** 是否为新绑定 */
  isNewBinding: boolean;
  /** 绑定原因 */
  bindingReason: 'session' | 'available' | 'fallback';
}
```

### 路由算法

```typescript
async selectAccount(request: RequestData): Promise<AccountSelectionResult> {
  const sessionId = this.extractSessionId(request);

  // 优先级 1: 检查会话绑定
  if (this.sessionBindings.has(sessionId)) {
    const boundAccountId = this.sessionBindings.get(sessionId)!;
    const account = this.poolManager.getAccount(boundAccountId);

    if (account && this.poolManager.isAccountAvailable(account)) {
      // 尝试获取并发槽位
      const acquired = await this.concurrencyManager.acquireSlot(boundAccountId, sessionId);
      if (acquired) {
        return {
          accountId: boundAccountId,
          isNewBinding: false,
          bindingReason: 'session',
        };
      }
    }

    // 绑定的账号不可用，解除绑定
    this.sessionBindings.delete(sessionId);
  }

  // 优先级 2: 选择可用账号
  const availableAccounts = this.poolManager
    .getAvailableAccounts()
    .filter(a => a.concurrency.current < a.concurrency.max);

  if (availableAccounts.length === 0) {
    throw new Error('所有账号都不可用');
  }

  // 按用量剩余比例排序，选择最空闲的账号
  const selected = availableAccounts.sort((a, b) => {
    const ratioA = 1 - (a.usage.last5Hours / a.config.last5HoursLimit);
    const ratioB = 1 - (b.usage.last5Hours / b.config.weeklyLimit);
    return ratioB - ratioA;
  })[0];

  // 获取并发槽位
  await this.concurrencyManager.acquireSlot(selected.id, sessionId);

  // 建立会话绑定
  this.sessionBindings.set(sessionId, selected.id);

  return {
    accountId: selected.id,
    isNewBinding: true,
    bindingReason: 'available',
  };
}
```

### 与现有路由集成

修改 `packages/core/src/utils/router.ts`:

```typescript
import { PoolRouter } from '../services/pool-router';

let poolRouter: PoolRouter | null = null;

/**
 * 初始化账号池路由
 */
export function initPoolRouter(config: AccountPoolConfig) {
  const poolManager = PoolManager.getInstance();
  const concurrencyManager = new ConcurrencyManager(poolManager);
  poolRouter = new PoolRouter(poolManager, concurrencyManager);
}

/**
 * 获取路由配置 (修改现有函数)
 */
export async function routeRequest(
  req: RequestData,
  config: Config
): Promise<{ provider: string; model: string }> {
  // 如果启用了账号池，优先使用账号池路由
  if (poolRouter && config.CodingPlanPool?.enabled) {
    const selection = await poolRouter.selectAccount(req);
    const account = poolRouter.poolManager.getAccount(selection.accountId);

    return {
      provider: 'codingplan', // 特殊提供商标识
      model: account.apiKey,  // 使用 API Key 作为模型标识
    };
  }

  // 否则使用原有路由逻辑
  return Router.default(req, config);
}
```

### 配置修改

在 `config.json` 中添加:

```json
{
  "CodingPlanPool": {
    "enabled": true,
    "accounts": [],
    "settings": {
      "defaultMaxConcurrency": 3,
      "sessionBinding": {
        "enabled": true,
        "ttlMinutes": 60
      }
    }
  },
  "Providers": [
    {
      "name": "codingplan",
      "api_base_url": "dynamic",
      "api_key": "dynamic",
      "models": ["dynamic"]
    }
  ]
}
```

---

## 验收标准

- [x] 会话绑定工作正常
- [x] 优先选择绑定的账号
- [x] 绑定账号不可用时选择其他账号
- [x] 并发槽位正确获取和释放
- [x] 与现有路由系统兼容

**完成时间**: 2026-03-10
**状态**: ✅ 已完成

---

## 实现总结

### 新增文件
- `packages/core/src/services/pool-router.ts` - PoolRouter 类实现

### 修改文件
- `packages/core/src/utils/router.ts` - 添加 PoolRouter 初始化和集成
- `packages/core/src/server.ts` - 添加槽位释放 hook
- `packages/core/src/api/routes.ts` - 处理 pool account 动态凭据

### 工作流程
1. 请求到达时，router.ts 中的 getUseModel 检查 PoolRouter 是否启用
2. 如果启用，selectAccount 选择账号并获取并发槽位
3. 建立会话绑定 (sessionId -> accountId)
4. routes.ts 使用账号池凭据动态覆盖 provider 配置
5. 响应完成后，onResponse hook 释放并发槽位

---

## 相关文件

- [Task 1.2 PoolManager](./task-1.2-pool-manager.md)
- [Task 1.3 ConcurrencyManager](./task-1.3-concurrency-manager.md)
- [Phase 1 计划](./README.md)
- [主计划](../coding-plan-pool-implementation-plan.md)
