# Task 3.4-3.6: 告警与高级功能

**优先级**: P2
**预计时间**: 8 小时 (合计)
**依赖**: Phase 2 完成
**状态**: 已完成 ✅
**完成时间**: 2026-03-10

---

## 完成总结

### Task 3.4: 账号受限告警 ✅

**实现文件**: `packages/core/src/services/alerts.ts`

**实现功能**:
- 账号受限告警
- 用量阈值告警（5 小时和周用量）
- 并发使用告警
- 账号状态变化检测
- 告警历史纪录（最多 100 条）
- 冷却机制（5 分钟）防止重复告警
- 回调系统支持 webhook/邮件通知

### Task 3.5: 历史用量统计 ✅

**实现文件**: `packages/core/src/services/usage-history.ts`

**实现功能**:
- 自动记录用量快照（5 分钟间隔）
- 历史数据持久化存储
- 支持按账户查询历史记录
- 用量趋势分析
- 用量耗尽时间预测
- 自动清理过期数据（默认 7 天）

### Task 3.6: 高级路由策略 ✅

**实现文件**: `packages/core/src/services/smart-router.ts`

**实现功能**:
- 多因素账号评分系统
  - 用量评分（40% 权重）
  - 并发评分（30% 权重）
  - 健康评分（30% 权重）
- 错误率跟踪
- 用量预测
- 账号排名
- 智能选择最优账号

### 文件位置
`packages/core/src/services/alerts.ts`

### 功能说明

当账号受限或用量接近阈值时，发送告警通知。

### 核心功能

```typescript
/**
 * 告警服务
 *
 * 功能:
 * - 账号受限告警
 * - 用量阈值告警
 * - 告警历史纪录
 */
export class AlertService {
  private alerts: AlertRecord[];
  private handlers: AlertHandler[];

  /**
   * 注册告警处理器
   */
  registerHandler(handler: AlertHandler): void;

  /**
   * 发送告警
   */
  sendAlert(alert: AlertRecord): void;

  /**
   * 账号受限告警
   */
  notifyAccountLimited(account: CodingPlanAccount, error: ApiError): void;

  /**
   * 用量阈值告警
   */
  notifyUsageThreshold(account: CodingPlanAccount, threshold: number): void;

  /**
   * 获取告警历史
   */
  getHistory(options?: { limit?: number; type?: string }): AlertRecord[];

  /**
   * 清除历史
   */
  clearHistory(): void;
}

/**
 * 告警记录
 */
export interface AlertRecord {
  id: string;
  type: 'account_limited' | 'usage_threshold' | 'error' | 'warning';
  accountId?: string;
  title: string;
  message: string;
  timestamp: Date;
  data?: any;
}

/**
 * 告警处理器
 */
export interface AlertHandler {
  handle(alert: AlertRecord): Promise<void>;
}
```

### 内置告警处理器

```typescript
/**
 * 控制台日志处理器
 */
export class ConsoleAlertHandler implements AlertHandler {
  async handle(alert: AlertRecord): Promise<void> {
    const icon = {
      'account_limited': '🚫',
      'usage_threshold': '⚠️',
      'error': '❌',
      'warning': '⚡',
    }[alert.type] || '📢';

    console.log(`${icon} [${alert.type}] ${alert.title}`);
    console.log(`   ${alert.message}`);
    if (alert.accountId) {
      console.log(`   Account: ${alert.accountId}`);
    }
  }
}

/**
 * Webhook 处理器 (可选)
 */
export class WebhookAlertHandler implements AlertHandler {
  private webhookUrl: string;

  constructor(webhookUrl: string) {
    this.webhookUrl = webhookUrl;
  }

  async handle(alert: AlertRecord): Promise<void> {
    await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: alert.type,
        title: alert.title,
        message: alert.message,
        timestamp: alert.timestamp,
        data: alert.data,
      }),
    });
  }
}

/**
 * 文件日志处理器
 */
export class FileAlertHandler implements AlertHandler {
  private logPath: string;

  constructor(logPath: string) {
    this.logPath = logPath;
  }

  async handle(alert: AlertRecord): Promise<void> {
    const line = JSON.stringify({
      ...alert,
      timestamp: alert.timestamp.toISOString(),
    }) + '\n';

    await fs.appendFile(this.logPath, line);
  }
}
```

### 用量阈值监控

```typescript
/**
 * 用量监控服务
 */
export class UsageMonitorService {
  private poolManager: PoolManager;
  private alertService: AlertService;
  private checkInterval?: NodeJS.Timeout;

  constructor(
    poolManager: PoolManager,
    alertService: AlertService,
    options: { checkIntervalMinutes?: number; threshold?: number }
  ) {
    this.poolManager = poolManager;
    this.alertService = alertService;
  }

  /**
   * 启动监控
   */
  start(): void {
    const interval = this.options.checkIntervalMinutes || 5;

    this.checkInterval = setInterval(() => {
      this.checkUsage();
    }, interval * 60 * 1000);
  }

  /**
   * 检查用量
   */
  private checkUsage(): void {
    const accounts = this.poolManager.getAllAccounts();
    const threshold = this.options.threshold || 0.8; // 80%

    for (const account of accounts) {
      const usageRatio = account.usage.last5Hours / account.config.last5HoursLimit;

      if (usageRatio >= threshold) {
        this.alertService.notifyUsageThreshold(account, usageRatio);
      }
    }
  }
}
```

---

## Task 3.5: 历史用量统计

### 文件位置
`packages/core/src/services/usage-history.ts`

### 功能说明

记录历史用量数据，支持趋势分析和报表展示。

### 核心功能

```typescript
/**
 * 历史用量记录
 */
export interface UsageHistoryRecord {
  accountId: string;
  timestamp: Date;
  last5Hours: number;
  weekly: number;
  last5HoursPercentage: number;
  weeklyPercentage: number;
  requestsCount: number;
}

/**
 * 历史用量服务
 */
export class UsageHistoryService {
  private history: Map<string, UsageHistoryRecord[]>;
  private storagePath: string;

  /**
   * 记录用量快照
   */
  recordSnapshot(accountId: string, account: CodingPlanAccount): void;

  /**
   * 获取账号历史
   */
  getHistory(accountId: string, options: {
    startTime?: Date;
    endTime?: Date;
    limit?: number;
  }): UsageHistoryRecord[];

  /**
   * 获取用量趋势
   */
  getTrend(accountId: string, hours: number): {
    timestamp: string;
    value: number;
  }[];

  /**
   * 清理过期数据
   */
  cleanup(olderThanDays: number): void;
}
```

---

## Task 3.6: 高级路由策略

### 文件位置
`packages/core/src/services/smart-router.ts`

### 功能说明

基于用量预测和账号负载的智能路由策略。

### 核心功能

```typescript
/**
 * 智能路由器
 *
 * 功能:
 * - 基于用量预测的路由
 * - 动态账号权重调整
 * - 负载均衡
 */
export class SmartRouter {
  private poolManager: PoolManager;
  private usageHistory: UsageHistoryService;

  /**
   * 选择最佳账号
   */
  selectBestAccount(sessionId: string): AccountSelectionResult {
    const accounts = this.poolManager.getAvailableAccounts();

    // 计算每个账号的得分
    const scored = accounts.map(account => ({
      account,
      score: this.calculateScore(account),
    }));

    // 选择得分最高的账号
    const selected = scored.sort((a, b) => b.score - a.score)[0];

    return {
      accountId: selected.account.id,
      score: selected.score,
      reason: this.getScoreReason(selected.account, selected.score),
    };
  }

  /**
   * 计算账号得分
   */
  private calculateScore(account: CodingPlanAccount): number {
    let score = 100;

    // 用量得分 (剩余越多得分越高)
    const usageRatio = account.usage.last5Hours / account.config.last5HoursLimit;
    score -= usageRatio * 40;

    // 并发得分 (可用槽位越越多得分越高)
    const concurrencyRatio = account.concurrency.current / account.concurrency.max;
    score -= concurrencyRatio * 30;

    // 健康得分 (历史错误率越低得分越高)
    const errorRate = this.getErrorRate(account.id);
    score -= errorRate * 30;

    return Math.max(0, score);
  }

  /**
   * 预测用量耗尽时间
   */
  predictExhaustionTime(accountId: string): Date | null {
    const history = this.usageHistory.getHistory(accountId, { limit: 12 }); // 最近 1 小时数据

    if (history.length < 2) return null;

    // 计算每小时用量增长率
    const growthRate = this.calculateGrowthRate(history);
    const currentUsage = history[history.length - 1].last5HoursPercentage;

    // 预测耗尽时间
    const remainingCapacity = 1 - currentUsage;
    const hoursUntilExhaustion = remainingCapacity / growthRate;

    return new Date(Date.now() + hoursUntilExhaustion * 60 * 60 * 1000);
  }
}
```

---

## 验收标准

### AlertService
- [ ] 账号受限时发送告警
- [ ] 用量超过阈值发送告警
- [ ] 支持多种告警处理器

### UsageHistoryService
- [ ] 正确记录用量快照
- [ ] 历史数据查询正常
- [ ] 过期数据自动清理

### SmartRouter
- [ ] 账号得分计算合理
- [ ] 选择最优账号
- [ ] 用量预测准确

---

## 相关文件

- [Phase 3 计划](./README.md)
- [Phase 2 完成](../phase2/README.md)
- [主计划](../coding-plan-pool-implementation-plan.md)
