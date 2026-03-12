# Task 2.4-2.5: 用量管理

**优先级**: P0
**预计时间**: 4 小时 (合计)
**依赖**: Phase 1 完成

---

## Task 2.4: Z.ai 用量 API 调用

### 文件位置
`packages/core/src/api/zai-usage.ts`

### API 参考

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/monitor/usage/model-usage` | GET | 模型用量统计 |
| `/api/monitor/usage/tool-usage` | GET | 工具用量统计 |
| `/api/monitor/usage/quota/limit` | GET | 配额限制信息 |

### 核心功能

```typescript
/**
 * Z.ai 用量 API 客户端
 */
export class ZaiUsageClient {
  private apiBaseUrl: string;
  private apiKey: string;

  constructor(options: { apiBaseUrl: string; apiKey: string });

  /**
   * 获取模型用量
   */
  getModelUsage(timeRange: TimeRange): Promise<ModelUsageResponse>;

  /**
   * 获取工具用量
   */
  getToolUsage(timeRange: TimeRange): Promise<ToolUsageResponse>;

  /**
   * 获取配额限制
   */
  getQuotaLimit(): Promise<QuotaLimitResponse>;

  /**
   * 获取完整用量信息
   */
  getFullUsage(): Promise<FullUsageResponse>;
}

/**
 * 时间范围
 */
export interface TimeRange {
  startTime: string; // 格式：yyyy-MM-dd HH:mm:ss
  endTime: string;
}

/**
 * 配额限制响应
 */
export interface QuotaLimitResponse {
  data: {
    limits: Array<{
      type: 'TOKENS_LIMIT' | 'TIME_LIMIT';
      percentage: number;
      currentUsage?: number;
      total?: number;
      usageDetails?: any;
    }>;
  };
}

/**
 * 模型用量响应
 */
export interface ModelUsageResponse {
  data: {
    items: Array<{
      model: string;
      tokens: number;
      requests: number;
      timestamp: string;
    }>;
  };
}
```

### 实现

```typescript
import https from 'https';

export class ZaiUsageClient {
  constructor(options: { apiBaseUrl: string; apiKey: string }) {
    this.apiBaseUrl = options.apiBaseUrl;
    this.apiKey = options.apiKey;
  }

  /**
   * 格式化时间为 API 要求的格式
   */
  private formatTime(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  /**
   * 获取配额限制
   */
  async getQuotaLimit(): Promise<QuotaLimitResponse> {
    return this.request('/api/monitor/usage/quota/limit', {});
  }

  /**
   * 获取模型用量
   */
  async getModelUsage(timeRange?: TimeRange): Promise<ModelUsageResponse> {
    const now = new Date();
    const defaultRange: TimeRange = {
      // 默认查询过去 5 小时
      startTime: this.formatTime(new Date(now.getTime() - 5 * 60 * 60 * 1000)),
      endTime: this.formatTime(now),
    };

    const range = timeRange || defaultRange;
    return this.request('/api/monitor/usage/model-usage', range);
  }

  /**
   * 通用请求方法
   */
  private async request<T>(path: string, params: Record<string, any>): Promise<T> {
    const parsedBaseUrl = new URL(this.apiBaseUrl);
    const baseDomain = `${parsedBaseUrl.protocol}//${parsedBaseUrl.host}`;
    const url = new URL(path, baseDomain);

    // 添加查询参数
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });

    return new Promise<T>((resolve, reject) => {
      const req = https.request(url.toString(), {
        method: 'GET',
        headers: {
          'Authorization': this.apiKey,
          'Accept-Language': 'en-US,en',
          'Content-Type': 'application/json',
        },
      }, (res) => {
        let data = '';

        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }

          try {
            const json = JSON.parse(data);
            resolve(json);
          } catch (e) {
            reject(new Error(`JSON parse error: ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.end();
    });
  }
}
```

---

## Task 2.5: 定时用量同步

### 文件位置
`packages/core/src/services/usage-sync.ts`

### 核心功能

```typescript
/**
 * 用量同步服务
 *
 * 功能:
 * - 定时从 Z.ai API 同步用量数据
 * - 更新账号池中的用量状态
 */
export class UsageSyncService {
  private poolManager: PoolManager;
  private syncIntervalMs: number;
  private syncTimer?: NodeJS.Timeout;
  private clients: Map<string, ZaiUsageClient>; // accountId -> client

  constructor(poolManager: PoolManager, options: { intervalMinutes: number });

  /**
   * 启动同步
   */
  start(): void;

  /**
   * 停止同步
   */
  stop(): void;

  /**
   * 手动同步指定账号
   */
  syncAccount(accountId: string): Promise<void>;

  /**
   * 同步所有账号
   */
  syncAll(): Promise<void>;
}
```

### 实现

```typescript
export class UsageSyncService {
  constructor(
    private poolManager: PoolManager,
    private options: { intervalMinutes: number }
  ) {
    this.syncIntervalMs = options.intervalMinutes * 60 * 1000;
  }

  /**
   * 启动定时同步
   */
  start(): void {
    logger.info(`Starting usage sync (interval: ${this.options.intervalMinutes}m)`);

    // 立即执行一次
    this.syncAll().catch(err => {
      logger.error('Initial sync failed:', err);
    });

    // 定时同步
    this.syncTimer = setInterval(() => {
      this.syncAll().catch(err => {
        logger.error('Scheduled sync failed:', err);
      });
    }, this.syncIntervalMs);
  }

  /**
   * 停止同步
   */
  stop(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = undefined;
    }
  }

  /**
   * 同步所有账号
   */
  async syncAll(): Promise<void> {
    const accounts = this.poolManager.getAllAccounts()
      .filter(a => a.status === 'active');

    logger.debug(`Syncing usage for ${accounts.length} accounts`);

    for (const account of accounts) {
      await this.syncAccount(account.id).catch(err => {
        logger.error(`Failed to sync account ${account.id}:`, err);
      });
    }
  }

  /**
   * 同步单个账号
   */
  async syncAccount(accountId: string): Promise<void> {
    const account = this.poolManager.getAccount(accountId);
    if (!account) return;

    // 获取或创建客户端
    let client = this.clients.get(accountId);
    if (!client) {
      client = new ZaiUsageClient({
        apiBaseUrl: account.apiBaseUrl,
        apiKey: account.apiKey,
      });
      this.clients.set(accountId, client);
    }

    // 获取配额限制
    const quotaLimit = await client.getQuotaLimit();

    // 解析配额数据
    const tokenLimit = quotaLimit.data.limits.find(l => l.type === 'TOKENS_LIMIT');
    const timeLimit = quotaLimit.data.limits.find(l => l.type === 'TIME_LIMIT');

    // 更新账号用量状态
    account.usage = {
      ...account.usage,
      last5HoursPercentage: tokenLimit?.percentage || 0,
      weeklyPercentage: timeLimit?.percentage || 0,
      lastUpdated: new Date(),
    };

    // 如果用量接近阈值，标记账号
    const bufferRatio = account.config.bufferRatio || 0.1;
    if ((tokenLimit?.percentage || 0) > 1 - bufferRatio) {
      logger.warn(`Account ${account.id} approaching 5h limit: ${(tokenLimit.percentage * 100).toFixed(1)}%`);
    }

    logger.debug(`Synced account ${account.id}: 5h=${(tokenLimit?.percentage || 0) * 100}%, weekly=${(timeLimit?.percentage || 0) * 100}%`);
  }
}
```

---

## 验收标准

### ZaiUsageClient
- [x] 正确调用 Z.ai API ✅
- [x] 错误处理完善 ✅
- [x] 响应数据解析正确 ✅

### UsageSyncService
- [x] 定时同步执行 ✅
- [x] 用量数据正确更新 ✅
- [x] 接近阈值时告警 ✅
- [x] 同步失败不影响主流程 ✅

**完成时间**: 2026-03-10
**状态**: ✅ 已完成

---

## 实现总结

### 新增文件
- `packages/core/src/api/zai-usage.ts` - Z.ai 用量 API 客户端
- `packages/core/src/services/usage-sync.ts` - 用量同步服务

### 类型定义
- `packages/core/src/types/pool.ts` - 添加用量相关类型：
  - `TimeRange` - 时间范围
  - `QuotaLimitResponse` - 配额限制响应
  - `ModelUsageResponse` - 模型用量响应
  - `ToolUsageResponse` - 工具用量响应
  - `FullUsageResponse` - 完整用量响应

### 核心功能

**ZaiUsageClient 类**:
- `getQuotaLimit()` - 获取配额限制信息
- `getModelUsage(timeRange)` - 获取模型用量统计
- `getToolUsage(timeRange)` - 获取工具用量统计
- `getFullUsage(timeRange)` - 一次性获取所有用量数据
- 静态方法 `parseQuotaPercentages()` - 解析配额百分比
- 静态方法 `calculateTotalTokens()` / `calculateTotalRequests()` - 统计工具方法

**UsageSyncService 类**:
- `start()` - 启动定时同步（立即执行一次 + 周期性执行）
- `stop()` - 停止定时同步
- `syncAccount(accountId)` - 手动同步指定账号
- `syncAll()` - 同步所有活跃账号
- `getStats()` - 获取同步服务状态
- `setInterval(intervalMinutes)` - 动态调整同步间隔

### 工作流程

1. 服务启动时创建 `UsageSyncService` 实例
2. 调用 `start()` 启动定时同步（默认 5 分钟）
3. 每次同步遍历所有活跃账号，调用 Z.ai API 获取用量数据
4. 更新账号的 `usage.last5HoursPercentage` 和 `usage.weeklyPercentage`
5. 当用量超过阈值（1 - bufferRatio）时触发告警
6. 同步失败不影响其他账号和主流程

---

## 相关文件

- [Phase 2 计划](./README.md)
- [Phase 1 完成](../phase1/README.md)
- [主计划](../coding-plan-pool-implementation-plan.md)

- [Phase 2 计划](./README.md)
- [Phase 1 完成](../phase1/README.md)
- [主计划](../coding-plan-pool-implementation-plan.md)
