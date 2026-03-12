# Coding Plan 账号池化管理需求讨论

**创建日期**: 2026-03-09
**状态**: 讨论中
**版本**: v0.3

**更新日期**: 2026-03-09 (v0.3)
- 确认部署架构：单实例
- 确认账号配置方式：动态添加
- 确认 Z.ai 提供用量查询 API
- 参考文档：https://docs.bigmodel.cn/cn/coding-plan/quick-start
- 参考插件：https://github.com/zai-org/zai-coding-plugins

---

## 执行摘要

**核心目标**: 将 20 个 Coding Plan 账号共享给 80 名员工使用，实现账号池化管理。

**三大核心需求**:

| 需求 | 解决方案 | 状态 |
|------|----------|------|
| 用量池化 + 并发控制 | 定时调用 Z.ai 用量 API + 内存级并发槽位管理 | ✅ 方案明确 |
| 错误自动切换 | 识别限流错误 + 请求重试 + 账号切换 | ✅ 方案明确 |
| 会话上下文保持 | 基于 conversation_id 的会话绑定机制 | ✅ 方案明确 |

**关键 API 信息**:
- Z.ai 提供官方用量查询 API：`/api/monitor/usage/model-usage`、`/api/monitor/usage/quota/limit`
- 认证方式：`Authorization: <ANTHROPIC_AUTH_TOKEN>`
- 并发限制：每个账号默认 3 并发
- 用量周期：5 小时（Token 用量）、1 个月（MCP 用量）

**预计工作量**:
- Phase 1 (基础架构): 2-3 天
- Phase 2 (核心功能): 3-5 天
- Phase 3 (增强功能): 3-5 天

**下一步**:
1. 通过实际调用 Z.ai API 确认错误码格式
2. 开始 Phase 1 开发（基础架构 + 并发控制）

---

## 需求背景

用户拥有若干个 Coding Plan 账号（例如 20 个），需要分配给更多员工（例如 80 名）使用。需要实现账号池化管理，包括用量监控、并发控制、自动切换和会话保持等功能。

---

## 需求分析

### 需求 1: 用量池化管理与并发控制

#### 1.1 用量限制管理

**问题描述**:
- 每个 Coding Plan 账号有每 5 小时用量限制
- 每个 Coding Plan 账号有每周总请求次数限制
- 需要定期查询用量并进行统一池化管理

**技术挑战**:
1. 需要获取每个账号的用量统计信息
2. 需要定时轮询用量数据（每 5 小时周期）
3. 需要预测用量消耗速率，提前预警
4. 需要实现用量池的统一调度算法

**关键问题**:
- Z.ai GLM Coding Plan 是否提供用量查询 API？
- 用量数据如何持久化存储？
- 如何计算"安全用量阈值"？

#### 1.2 并发控制

**问题描述**:
- 每个 Coding Plan 账号理论支持 3 个并发
- 当账号被占用时，新用户自动切换到其他可用账号

**技术挑战**:
1. 实时跟踪每个账号的并发使用状态
2. 实现并发槽位的获取和释放机制
3. 处理请求异常时的槽位释放
4. 并发状态的数据存储（内存/Redis/文件）

**关键问题**:
- ~~并发状态存储在哪里？（多实例部署时需要考虑共享存储）~~ **已确认单实例部署，使用内存存储即可**
- 如何检测"僵尸连接"（用户断开但未释放槽位）？
- 并发数是否可配置？

---

### 需求 2: 错误自动切换

**问题描述**:
- 用户请求过程中遇到使用限制报错时，自动切换到其他可用 Coding Plan 账号

**技术挑战**:
1. 识别哪些错误码/错误信息需要触发切换
2. 切换时保持请求的连续性（用户无感知）
3. 避免切换死循环（所有账号都受限时如何处理）
4. 切换后的请求重试机制

**关键问题**:
- Z.ai API 返回的错误格式是什么？
- 哪些错误需要切换，哪些错误应该直接返回给用户？
- 是否需要错误降级策略（如所有账号都受限）？

---

### 需求 3: 会话上下文保持

**问题描述**:
- 同一用户的问答会话过程中，上下文尽量发送到同一个 Coding Plan 账号
- 保持前缀缓存，提高模型响应速度

**技术挑战**:
1. 用户会话的唯一标识识别
2. 会话与账号的绑定关系管理
3. 绑定关系的过期和清理机制
4. 绑定关系与并发控制的冲突处理

**关键问题**:
- 如何识别用户会话？（conversation_id / session_id / 用户 token）
- 会话绑定的有效期是多久？
- 当绑定的账号不可用时，是否打破绑定？

---

## 技术方案设计

### 架构调整（基于单实例 + 动态添加）

由于采用**单实例部署**和**动态添加账号**，架构做如下调整：

```
┌─────────────────────────────────────────────────────────────────┐
│                    Claude Code Router Server                    │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                   账号池管理器 (Account Pool)              │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  内存状态存储 (Map/Cache)                            │  │  │
│  │  │  - accounts: Map<accountId, CodingPlanAccount>       │  │  │
│  │  │  - sessionBindings: Map<sessionId, accountId>        │  │  │
│  │  │  - 支持动态添加/删除/修改账号                        │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                 智能路由核心 (Smart Router)                │  │
│  │  - 会话绑定逻辑                                            │  │
│  │  - 并发控制                                                │  │
│  │  - 用量管理                                                │  │
│  │  - 错误恢复                                                │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    CLI 管理接口                            │  │
│  │  - ccr pool add       添加账号                             │  │
│  │  - ccr pool remove    删除账号                             │  │
│  │  - ccr pool list      列出账号                             │  │
│  │  - ccr pool status    查看账号状态                         │  │
│  │  - ccr pool binding   管理会话绑定                         │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Z.ai API 信息（基于 zai-coding-plugins 分析）

**API 端点**:
- Z.ai 平台：`https://api.z.ai`
- 智谱平台：`https://open.bigmodel.cn` 或 `https://dev.bigmodel.cn`
- 认证方式：`Authorization: <ANTHROPIC_AUTH_TOKEN>`

**用量查询 API**:
```
GET /api/monitor/usage/model-usage?startTime={startTime}&endTime={endTime}
GET /api/monitor/usage/tool-usage?startTime={startTime}&endTime={endTime}
GET /api/monitor/usage/quota/limit
```

**时间格式**: `yyyy-MM-dd HH:mm:ss`

**响应数据结构** (quota/limit):
```json
{
  "data": {
    "limits": [
      {
        "type": "TOKENS_LIMIT",      // Token 用量（5 小时）
        "percentage": 0.75            // 使用比例
      },
      {
        "type": "TIME_LIMIT",         // MCP 用量（1 个月）
        "percentage": 0.5,
        "currentUsage": 100,
        "total": 200,
        "usageDetails": {...}
      }
    ]
  }
}
```

**认证环境变量**:
- `ANTHROPIC_BASE_URL`: API 基础 URL
- `ANTHROPIC_AUTH_TOKEN`: API Key

### 配置方案设计（支持动态添加）

主配置文件 `~/.claude-code-router/config.json` 中添加：

```json
{
  "CodingPlanPool": {
    "enabled": true,
    "storage": "memory",  // 单实例使用内存存储
    "accounts": [],       // 动态添加，初始为空
    "settings": {
      "defaultMaxConcurrency": 3,
      "defaultUsageLimits": {
        "last5Hours": 100,
        "weekly": 1000
      },
      "bufferRatio": 0.1,
      "sessionBinding": {
        "enabled": true,
        "ttlMinutes": 60,
        "breakOnLimited": true
      },
      "errorRecovery": {
        "maxRetries": 3,
        "retryDelayMs": 1000
      },
      "usageSync": {
        "enabled": true,
        "intervalMinutes": 5,
        "apiEndpoints": {
          "modelUsage": "/api/monitor/usage/model-usage",
          "toolUsage": "/api/monitor/usage/tool-usage",
          "quotaLimit": "/api/monitor/usage/quota/limit"
        }
      }
    }
  }
}
```

```
┌─────────────────────────────────────────────────────────────────┐
│                      Claude Code Client                         │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Claude Code Router Server                    │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    请求拦截层                              │  │
│  │  - 识别用户会话                                            │  │
│  │  - 提取请求上下文                                          │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                │                                │
│                                ▼                                │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                 智能路由核心 (Smart Router)                │  │
│  │  ┌─────────────────┐  ┌─────────────────┐                │  │
│  │  │  会话绑定管理器  │  │   并发控制器    │                │  │
│  │  │  Session Binder │  │Concurrency Ctrl │                │  │
│  │  └─────────────────┘  └─────────────────┘                │  │
│  │  ┌─────────────────┐  ┌─────────────────┐                │  │
│  │  │  用量池管理器   │  │   错误恢复器    │                │  │
│  │  │  Usage Pool Mgr │  │  Error Handler  │                │  │
│  │  └─────────────────┘  └─────────────────┘                │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                │                                │
│                                ▼                                │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                   账号选择算法                              │  │
│  │  1. 检查会话绑定 → 2. 检查并发槽位 → 3. 检查用量限额       │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                │                                │
└─────────────────────────────────────────────────────────────────┘
                                │
          ┌─────────────────────┼─────────────────────┐
          ▼                     ▼                     ▼
   ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
   │ Coding Plan 1│      │ Coding Plan 2│      │ Coding Plan N│
   │  (账号 1)     │      │  (账号 2)     │      │  (账号 N)    │
   └──────────────┘      └──────────────┘      └──────────────┘
```

### 核心模块设计

#### 1. 账号池状态管理 (Account Pool State)

```typescript
interface CodingPlanAccount {
  id: string;                    // 账号唯一标识
  name: string;                  // 账号名称/备注
  apiKey: string;                // API Key
  status: 'active' | 'limited' | 'error';  // 账号状态

  // 并发状态
  concurrency: {
    current: number;             // 当前并发数
    max: number;                 // 最大并发数 (默认 3)
    slots: Set<string>;          // 占用槽位的会话 ID
  };

  // 用量状态
  usage: {
    last5Hours: number;          // 近 5 小时请求数
    last5HoursLimit: number;     // 5 小时限额
    weekly: number;              // 本周请求数
    weeklyLimit: number;         // 周限额
    lastUpdated: Date;           // 用量最后更新时间
  };

  // 会话绑定
  sessions: {
    [sessionId: string]: Date;   // 会话 ID → 最后活跃时间
  };
}

interface AccountPool {
  accounts: Map<string, CodingPlanAccount>;
  sessionBindings: Map<string, string>;  // sessionId → accountId
}
```

#### 2. 智能路由算法

```typescript
async function selectAccount(request: Request): Promise<string | null> {
  const sessionId = extractSessionId(request);

  // 优先级 1: 检查会话绑定
  if (sessionBindings.has(sessionId)) {
    const boundAccountId = sessionBindings.get(sessionId);
    const account = accounts.get(boundAccountId);

    if (account && isAccountAvailable(account)) {
      // 绑定的账号可用，优先使用
      return boundAccountId;
    }
  }

  // 优先级 2: 选择可用账号（用量充足 + 有并发槽位）
  const availableAccounts = Array.from(accounts.values())
    .filter(isAccountAvailable);

  if (availableAccounts.length === 0) {
    // 所有账号都不可用，尝试错误恢复策略
    return handleAllAccountsLimited();
  }

  // 按用量剩余比例排序，选择最空闲的账号
  const selected = availableAccounts
    .sort((a, b) => {
      const ratioA = 1 - (a.usage.last5Hours / a.usage.last5HoursLimit);
      const ratioB = 1 - (b.usage.last5Hours / b.usage.last5HoursLimit);
      return ratioB - ratioA;  // 剩余比例高的优先
    })[0];

  // 建立会话绑定
  sessionBindings.set(sessionId, selected.id);

  return selected.id;
}

function isAccountAvailable(account: CodingPlanAccount): boolean {
  // 检查账号状态
  if (account.status !== 'active') return false;

  // 检查并发数
  if (account.concurrency.current >= account.concurrency.max) return false;

  // 检查 5 小时用量 (保留 10% 缓冲)
  const usageRatio = account.usage.last5Hours / account.usage.last5HoursLimit;
  if (usageRatio > 0.9) return false;

  // 检查周用量 (保留 10% 缓冲)
  const weeklyRatio = account.usage.weekly / account.usage.weeklyLimit;
  if (weeklyRatio > 0.9) return false;

  return true;
}
```

#### 3. 并发控制机制

```typescript
class ConcurrencyManager {
  // 获取并发槽位
  async acquireSlot(accountId: string, sessionId: string): Promise<boolean> {
    const account = this.accounts.get(accountId);
    if (!account) return false;

    if (account.concurrency.current >= account.concurrency.max) {
      return false;
    }

    account.concurrency.current++;
    account.concurrency.slots.add(sessionId);

    return true;
  }

  // 释放并发槽位
  async releaseSlot(accountId: string, sessionId: string): Promise<void> {
    const account = this.accounts.get(accountId);
    if (!account) return;

    account.concurrency.current--;
    account.concurrency.slots.delete(sessionId);
  }

  // 心跳检测（防止僵尸连接）
  async startHeartbeatCheck(intervalMs: number = 30000) {
    setInterval(() => {
      this.accounts.forEach((account, accountId) => {
        // 检查长时间无活动的槽位
        // 可以通过 WebSocket 心跳或 SSE 连接状态判断
      });
    }, intervalMs);
  }
}
```

#### 4. 用量监控与同步

```typescript
class UsageMonitor {
  // 定时同步用量数据
  async startUsageSync(intervalMs: number = 5 * 60 * 1000) {  // 每 5 分钟
    // 轮询周期设置为 5 分钟的倍数，避免 API 限流
    setInterval(async () => {
      for (const [accountId, account] of this.accounts) {
        try {
          const usage = await this.fetchAccountUsage(account.apiKey);
          account.usage = {
            ...account.usage,
            ...usage,
            lastUpdated: new Date()
          };
        } catch (error) {
          logger.error(`Failed to fetch usage for ${accountId}`, error);
        }
      }
    }, intervalMs);
  }

  // 调用 Z.ai 用量查询 API
  async fetchAccountUsage(apiKey: string): Promise<UsageData> {
    // TODO: 需要确认 Z.ai 是否提供用量查询 API
    // 可能的端点：GET /api/usage 或 GET /api/billing/usage
  }
}
```

#### 5. 错误处理与自动切换

```typescript
class ErrorHandler {
  // 判断是否需要切换账号
  shouldSwitchAccount(error: ApiError): boolean {
    const switchableErrors = [
      'RATE_LIMIT_EXCEEDED',
      'QUOTA_EXHAUSTED',
      'CONCURRENT_LIMIT_REACHED',
      'ACCOUNT_SUSPENDED',
      // 5xx 服务器错误也可以考虑切换
      'INTERNAL_SERVER_ERROR',
    ];

    return switchableErrors.includes(error.code);
  }

  // 处理账号受限
  async handleAccountLimited(accountId: string, error: ApiError): Promise<void> {
    const account = this.accounts.get(accountId);
    if (!account) return;

    // 标记账号为受限状态
    account.status = 'limited';

    // 记录受限原因和时间
    account.limitedInfo = {
      reason: error.code,
      time: new Date(),
      details: error.message
    };

    // 释放该账号的所有并发槽位
    account.concurrency.current = 0;
    account.concurrency.slots.clear();
  }
}
```

#### 6. 配置方案设计

```json
{
  "CodingPlanPool": {
    "enabled": true,
    "accounts": [
      {
        "id": "cp-001",
        "name": "主账号 1",
        "apiKey": "$Z_AI_API_KEY_1",
        "maxConcurrency": 3,
        "usageLimits": {
          "last5Hours": 100,
          "weekly": 1000
        }
      }
      // ... 更多账号
    ],
    "usageSync": {
      "enabled": true,
      "intervalMinutes": 5,
      "bufferRatio": 0.1
    },
    "sessionBinding": {
      "enabled": true,
      "ttlMinutes": 60,
      "breakOnLimited": true
    },
    "errorRecovery": {
      "maxRetries": 3,
      "retryDelayMs": 1000,
      "switchableErrors": ["RATE_LIMIT_EXCEEDED", "QUOTA_EXHAUSTED"]
    }
  }
}
```

---

## 待确认问题

### 1. Z.ai API 相关（已确认）

| 问题 | 说明 | 状态 |
|------|------|------|
| 用量查询 API | **已确认存在**，通过 `/api/monitor/usage/model-usage` 等端点查询 | ✅ 已确认 |
| 认证方式 | 使用 `Authorization: <token>` _header_，与 Anthropic 格式相同 | ✅ 已确认 |
| API 端点 | Z.ai: `https://api.z.ai`；智谱：`https://open.bigmodel.cn` | ✅ 已确认 |
| 错误码规范 | API 返回的错误码和错误格式 | ⏳ 需要实际调用测试 |
| 并发限制 | 3 并发是硬限制还是软限制？超限会返回什么错误？ | ⏳ 需要实际调用测试 |

### 2. 数据存储相关

| 问题 | 说明 | 优先级 | 建议方案 |
|------|------|--------|----------|
| 状态存储 | 并发状态和会话绑定存储在哪里？ | P1 | 单实例使用内存 Map |
| 数据持久化 | 重启后是否需要恢复会话绑定？ | P2 | 可选：持久化到文件 |

### 3. 业务逻辑相关

| 问题 | 说明 | 优先级 | 建议值 |
|------|------|--------|--------|
| 用量阈值 | 5 小时用量保留多少缓冲比例合适？ | P1 | 10% |
| 会话 TTL | 会话绑定有效期设置多久？ | P1 | 60 分钟 |
| 降级策略 | 所有账号都受限时如何处理？ | P1 | 队列等待 + 超时报错 |
| 优先级队列 | 是否需要实现请求优先级（VIP 用户优先）？ | P3 | 暂不实现 |

### 4. 需要实际测试验证

以下项目需要在开发过程中通过实际调用 Z.ai API 来验证：

- [ ] 用量查询 API 的响应格式（尤其是 token 用量字段）
- [ ] 并发超限时的错误响应（错误码、错误消息格式）
- [ ] 配额耗尽时的错误响应
- [ ] 5 小时用量的具体时间窗口计算方式
- [ ] 是否有请求频率限制（调用用量查询 API 的限制）

---

## 实现计划

### Phase 1: 基础架构 (P0) - 预计 2-3 天

**1.1 账号池数据结构设计**
- [ ] 定义 `CodingPlanAccount` 接口
- [ ] 定义 `AccountPool` 管理类
- [ ] 实现内存级账号池存储

**1.2 基本路由逻辑**
- [ ] 实现简单的轮询或随机选择算法
- [ ] 支持配置多账号
- [ ] 集成到现有路由系统

**1.3 并发控制**
- [ ] 实现并发槽位的获取 (`acquireSlot`)
- [ ] 实现并发槽位的释放 (`releaseSlot`)
- [ ] 请求结束时自动释放槽位
- [ ] SSE 连接断开检测和槽位清理

**1.4 CLI 管理命令**
- [ ] `ccr pool add` - 添加账号
- [ ] `ccr pool remove` - 删除账号
- [ ] `ccr pool list` - 列出账号及状态
- [ ] `ccr pool status` - 查看详细状态

### Phase 2: 核心功能 (P1) - 预计 3-5 天

**2.1 会话绑定**
- [ ] 基于 `conversation_id` 识别用户会话
- [ ] 实现会话与账号的绑定逻辑
- [ ] 绑定 TTL 和过期清理
- [ ] 绑定账号不可用时的打破策略

**2.2 错误自动切换**
- [ ] 识别可切换的错误类型（需要实际测试）
- [ ] 实现请求重试和账号切换
- [ ] 避免切换死循环
- [ ] 所有账号受限时的降级策略

**2.3 用量管理**
- [ ] 实现调用 Z.ai 用量查询 API
- [ ] 定时用量同步（每 5 分钟）
- [ ] 本地用量统计（自行计数）
- [ ] 用量预警（达到阈值时提前提防）

### Phase 3: 增强功能 (P2) - 预计 3-5 天

**3.1 状态持久化**
- [ ] 账号配置持久化到 `config.json`
- [ ] 会话绑定状态持久化（可选）
- [ ] 服务重启后恢复绑定关系

**3.2 监控与告警**
- [ ] 用量面板展示（UI 集成）
- [ ] 账号受限告警通知
- [ ] 历史用量统计

**3.3 高级路由策略**
- [ ] 基于用量预测的智能调度
- [ ] 动态调整账号权重

### Phase 4: 高级功能 (P3) - 待定

- [ ] 优先级队列（VIP 用户优先）
- [ ] 多实例状态同步（Redis）
- [ ] 用量报表和可视化

---

## 风险评估

| 风险 | 影响 | 可能性 | 缓解措施 |
|------|------|--------|----------|
| Z.ai 用量 API 响应格式不符预期 | 高 | 低 | 自行统计请求计数，估算用量 |
| 并发控制失效导致封号 | 高 | 中 | 保守设置并发数，增加 10% 缓冲 |
| 会话绑定导致负载不均 | 中 | 中 | 设置绑定 TTL，定期释放 |
| 所有账号同时受限 | 高 | 中 | 实现队列等待 + 友好报错 |
| 用量查询 API 调用频率限制 | 中 | 中 | 增加查询间隔，使用本地统计 |

---

## 下一步行动

1. [ ] **确认 Z.ai API 错误码格式** - 通过实际调用测试获取错误响应
2. [ ] **确认用量 API 响应格式** - 尤其是 token 用量的具体字段
3. [ ] **开始 Phase 1 开发** - 先实现基础架构和并发控制
4. [ ] **编写技术方案文档** - 详细的 API 设计和接口定义

---

## 附录

### A. Z.ai API 参考

**基础信息**:
- Z.ai 平台端点：`https://api.z.ai`
- 智谱平台端点：`https://open.bigmodel.cn` 或 `https://dev.bigmodel.cn`
- 认证方式：`Authorization: <ANTHROPIC_AUTH_TOKEN>`

**用量查询 API**:

| 接口 | 方法 | 参数 | 说明 |
|------|------|------|------|
| `/api/monitor/usage/model-usage` | GET | `startTime`, `endTime` | 模型用量统计 |
| `/api/monitor/usage/tool-usage` | GET | `startTime`, `endTime` | 工具用量统计 |
| `/api/monitor/usage/quota/limit` | GET | 无 | 配额限制信息 |

**时间参数格式**: `yyyy-MM-dd HH:mm:ss`

**示例请求**:
```javascript
const startTime = "2026-03-08 10:00:00";
const endTime = "2026-03-09 10:59:59";
const url = `https://api.z.ai/api/monitor/usage/model-usage?startTime=${startTime}&endTime=${endTime}`;

const response = await fetch(url, {
  method: 'GET',
  headers: {
    'Authorization': 'your-api-token',
    'Accept-Language': 'en-US,en'
  }
});
```

**示例响应** (quota/limit):
```json
{
  "data": {
    "limits": [
      {
        "type": "TOKENS_LIMIT",
        "percentage": 0.75
      },
      {
        "type": "TIME_LIMIT",
        "percentage": 0.5,
        "currentUsage": 100,
        "total": 200,
        "usageDetails": {...}
      }
    ]
  }
}
```

### B. 相关参考资料

- [Z.ai GLM Coding Plan 快速入门](https://docs.bigmodel.cn/cn/coding-plan/quick-start)
- [Z.ai Coding Plugins GitHub](https://github.com/zai-org/zai-coding-plugins)
- [CC Router 现有路由机制](../../packages/core/src/utils/router.ts)

### C. 术语表

| 术语 | 说明 |
|------|------|
| Coding Plan | Z.ai 推出的 AI 编程订阅服务 |
| 并发槽位 | 账号同时可处理的请求数（每个账号默认 3 个） |
| 会话绑定 | 用户会话与特定账号的固定关联 |
| 前缀缓存 | LLM 对重复上下文的缓存优化，可显著提高响应速度 |
| TOKENS_LIMIT | 5 小时 Token 用量限制 |
| TIME_LIMIT | MCP（Model Context Protocol）月度用量限制 |
