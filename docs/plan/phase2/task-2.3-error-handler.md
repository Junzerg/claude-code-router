# Task 2.3: 错误识别与自动切换

**优先级**: P0
**预计时间**: 3 小时
**依赖**: Phase 1 完成

---

## 目标

识别 Z.ai API 返回的错误类型，并在需要时自动切换到其他账号。

---

## 开发内容

### 文件位置
`packages/core/src/services/error-handler.ts`

### 核心功能

```typescript
/**
 * 错误处理器
 *
 * 功能:
 * - 识别可切换的错误类型
 * - 执行账号切换
 * - 避免切换死循环
 */
export class ErrorHandler {
  private poolManager: PoolManager;
  private poolRouter: PoolRouter;
  private retryHistory: Map<string, RetryRecord>;

  constructor(poolManager: PoolManager, poolRouter: PoolRouter);

  /**
   * 判断错误是否需要切换账号
   */
  shouldSwitchAccount(error: ApiError): boolean;

  /**
   * 处理错误并返回新的账号选择
   */
  async handleErrorAndSwitch(
    sessionId: string,
    failedAccountId: string,
    error: ApiError
  ): Promise<AccountSelectionResult | null>;

  /**
   * 记录错误历史
   */
  recordError(sessionId: string, accountId: string, error: ApiError): void;

  /**
   * 检查是否应该停止切换 (避免死循环)
   */
  shouldStopSwitching(sessionId: string): boolean;

  /**
   * 重置错误历史
   */
  resetHistory(sessionId: string): void;
}

/**
 * API 错误
 */
export interface ApiError {
  /** 错误码 */
  code?: string;
  /** 错误类型 */
  type?: string;
  /** 错误消息 */
  message: string;
  /** HTTP 状态码 */
  status?: number;
  /** 原始错误对象 */
  raw?: any;
}

/**
 * 重试记录
 */
interface RetryRecord {
  accountId: string;
  timestamp: number;
  error: ApiError;
}
```

### Z.ai 错误码映射

```typescript
/**
 * Z.ai 错误码类型
 */
export const ZaiErrorTypes = {
  // 限流错误
  RATE_LIMIT_EXCEEDED: 'rate_limit_exceeded',
  TOO_MANY_REQUESTS: 'too_many_requests',

  // 配额耗尽
  QUOTA_EXHAUSTED: 'quota_exhausted',
  INSUFFICIENT_QUOTA: 'insufficient_quota',

  // 并发限制
  CONCURRENT_LIMIT_REACHED: 'concurrent_limit_reached',

  // 账号问题
  ACCOUNT_SUSPENDED: 'account_suspended',
  INVALID_API_KEY: 'invalid_api_key',

  // 服务器错误 (可考虑切换)
  INTERNAL_ERROR: 'internal_error',
  SERVICE_UNAVAILABLE: 'service_unavailable',
} as const;

/**
 * 需要切换账号的错误
 */
const SWITCHABLE_ERRORS = [
  ZaiErrorTypes.RATE_LIMIT_EXCEEDED,
  ZaiErrorTypes.TOO_MANY_REQUESTS,
  ZaiErrorTypes.QUOTA_EXHAUSTED,
  ZaiErrorTypes.INSUFFICIENT_QUOTA,
  ZaiErrorTypes.CONCURRENT_LIMIT_REACHED,
  ZaiErrorTypes.INTERNAL_ERROR,
  ZaiErrorTypes.SERVICE_UNAVAILABLE,
];

/**
 * 不需要切换的错误 (直接返回给用户)
 */
const NON_SWITCHABLE_ERRORS = [
  ZaiErrorTypes.INVALID_API_KEY,
  ZaiErrorTypes.ACCOUNT_SUSPENDED,
  'invalid_request_error',  // 请求参数错误
  'context_length_exceeded', // 上下文超长
];
```

### 错误识别实现

```typescript
/**
 * 解析 Z.ai API 错误
 */
export function parseZaiError(error: any): ApiError {
  // HTTP 响应错误
  if (error.response?.data) {
    const data = error.response.data;
    return {
      code: data.error?.code || data.code,
      type: data.error?.type || data.type,
      message: data.error?.message || data.message || error.message,
      status: error.response.status,
      raw: data,
    };
  }

  // 已经是 ApiError 格式
  if (error.code || error.type) {
    return error as ApiError;
  }

  // 网络错误或其他
  return {
    message: error.message || 'Unknown error',
    raw: error,
  };
}

/**
 * 判断是否需要切换账号
 */
shouldSwitchAccount(error: ApiError): boolean {
  const errorCode = error.code || error.type;

  // 检查是否在可切换列表中
  if (SWITCHABLE_ERRORS.includes(errorCode)) {
    return true;
  }

  // 检查 HTTP 状态码
  if (error.status) {
    // 429: Too Many Requests
    // 502, 503, 504: 服务器错误
    if ([429, 502, 503, 504].includes(error.status)) {
      return true;
    }
  }

  return false;
}
```

### 账号切换实现

```typescript
/**
 * 处理错误并切换到新账号
 */
async handleErrorAndSwitch(
  sessionId: string,
  failedAccountId: string,
  error: ApiError
): Promise<AccountSelectionResult | null> {
  // 记录错误
  this.recordError(sessionId, failedAccountId, error);

  // 检查是否应该停止切换
  if (this.shouldStopSwitching(sessionId)) {
    logger.warn(`Stopped switching for session ${sessionId}`);
    return null;
  }

  // 标记账号为受限状态 (如果是配额错误)
  if (this.isQuotaError(error)) {
    const account = this.poolManager.getAccount(failedAccountId);
    if (account) {
      account.status = 'limited';
      account.limitedInfo = {
        reason: error.code || 'unknown',
        time: new Date(),
        details: error.message,
      };
    }
  }

  // 释放失败账号的槽位
  await this.poolRouter.concurrencyManager.releaseSlot(failedAccountId, sessionId);

  // 选择新账号 (排除失败的账号)
  const newSelection = await this.poolRouter.selectAccountWithExclusion(
    sessionId,
    [failedAccountId]
  );

  if (newSelection) {
    logger.info(
      `Switched from ${failedAccountId} to ${newSelection.accountId} ` +
      `due to ${error.code}`
    );
  }

  return newSelection;
}

/**
 * 检查是否应该停止切换
 */
shouldStopSwitching(sessionId: string): boolean {
  const history = this.retryHistory.get(sessionId) || [];

  // 如果 1 分钟内切换超过 3 次，停止切换
  const oneMinuteAgo = Date.now() - 60 * 1000;
  const recentErrors = history.filter(r => r.timestamp > oneMinuteAgo);

  return recentErrors.length >= 3;
}
```

---

## 验收标准

- [x] 正确识别 Z.ai 错误类型 ✅
- [x] 限流错误触发账号切换 ✅
- [x] 无效 API Key 错误不触发切换 ✅
- [x] 避免切换死循环 (1 分钟内最多 3 次) ✅
- [x] 切换后释放原账号槽位 ✅

**完成时间**: 2026-03-10
**状态**: ✅ 已完成

---

## 实现总结

### 新增文件
- `packages/core/src/services/error-handler.ts` - 错误处理器

### 类型定义
- `packages/core/src/types/pool.ts` - 添加错误处理相关类型:
  - `ZaiErrorTypes` - Z.ai 错误类型常量
  - `ApiError` - API 错误接口
  - `RetryRecord` - 重试记录
  - `ErrorHandlingResult` - 错误处理结果

### 核心功能

**ErrorHandler 类**:
- `parseZaiError(error)` - 解析 Z.ai API 错误，支持多种错误格式
- `shouldSwitchAccount(error)` - 判断错误是否需要切换账号
- `handleErrorAndSwitch(sessionId, failedAccountId, error)` - 处理错误并切换到新账号
- `recordError(sessionId, accountId, error)` - 记录错误历史
- `shouldStopSwitching(sessionId)` - 检查是否应该停止切换 (避免死循环)
- `resetHistory(sessionId)` - 重置错误历史 (请求成功后调用)

**错误类型映射**:

| 错误类型 | 是否切换 | 说明 |
|----------|----------|------|
| `rate_limit_exceeded` | ✅ | 速率限制超出 |
| `too_many_requests` | ✅ | 请求过多 (429) |
| `quota_exhausted` | ✅ | 配额耗尽 |
| `insufficient_quota` | ✅ | 配额不足 |
| `concurrent_limit_reached` | ✅ | 并发限制 |
| `internal_error` | ✅ | 服务器内部错误 |
| `service_unavailable` | ✅ | 服务不可用 |
| `invalid_api_key` | ❌ | API Key 无效 (不切换) |
| `account_suspended` | ❌ | 账号被封禁 (不切换) |

**错误处理流程**:

1. 捕获 API 错误并解析
2. 判断错误类型是否可切换
3. 检查重试历史，避免无限循环
4. 如是配额错误，标记账号为受限状态
5. 释放失败账号的并发槽位
6. 选择新账号 (排除失败的账号)
7. 建立新的会话绑定
8. 返回新账号选择结果

**防死循环机制**:

- 默认 1 分钟内最多切换 3 次
- 超过阈值后停止切换，返回错误给用户
- 成功请求后自动重置错误历史

---

## 相关文件

- [Phase 2 计划](./README.md)
- [Phase 1 完成](../phase1/README.md)
- [主计划](../coding-plan-pool-implementation-plan.md)
