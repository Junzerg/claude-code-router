# Phase 4: Pool & Provider Integration

**版本**: v1.0
**状态**: 规划中
**更新时间**: 2026-03-15

---

## 1. 业务背景

在 Phase 3 (Account Pooling) 的开发和联调过程中，我们发现目前的 Pool 系统在底层实现上与现有的 Provider 体系脱节。

## 2. 问题分析

### 2.1 根因定位

在 `packages/core/src/api/routes.ts` L46-66，一旦进入 Pool 逻辑，系统利用 `poolAccount` 动态构建"临时 Provider"：

```typescript
provider = {
  name: `codingplan-${poolAccount.id}`,
  apiKey: poolAccount.apiKey,
  baseUrl: baseUrl,
  models: [],
  transformer: { use: [] },   // ← 空的！
  _platform: poolAccount.platform,  // ← Hack
};
```

### 2.2 导致的问题

1. **Model Mapping 失效** — Provider 层面配置的模型名称映射被跳过
2. **Transformer 责任链失效** — `transformer.use: []` 空数组，所有平台特定的请求/响应拦截器不执行
3. **鉴权头 Hack** — 只能通过 `_platform` 字段在 `sendRequestToProvider` 中硬编码判断是否加 `Bearer` 前缀

### 2.3 问题本质

Pool（调度层）和 Provider（请求组装层）是两套独立系统，Pool 绕过了 Provider 的全部核心能力。

---

## 3. 解决方案：Provider 多 Key 原生支持

### 3.1 核心思路

不再把 Pool 和 Provider 作为两个独立系统。直接在 Provider 层面支持多个 API Key，Pool 调度逻辑下沉为 Provider 内部的 **"Key 选择策略"**。

### 3.2 架构对比

```
旧架构：
  请求 → Pool Router 选账号 → 构建临时 Provider ❌ → 跳过 Transformer/Auth

新架构：
  请求 → Provider 解析 → KeyPool: 选最优 Key → 完整 Transformer/Auth ✅
```

### 3.3 层级关系

```
┌─────────────────────────────────────────────────┐
│  Provider "zai"                                 │
│  baseUrl / transformer / models ← 共享          │
│                                                  │
│  ┌─────────────────────────────────────────┐    │
│  │  KeyPool (原 Pool/Account 概念下沉)      │    │
│  │                                         │    │
│  │  ┌──────────────┐  ┌──────────────┐    │    │
│  │  │ Key-1        │  │ Key-2        │    │    │
│  │  │ "Account-1"  │  │ "Account-2"  │    │    │
│  │  │ sk-key-1     │  │ sk-key-2     │    │    │
│  │  │ 并发: 1/3    │  │ 并发: 0/3    │    │    │
│  │  │ 5h用量: 40%  │  │ 5h用量: 20%  │    │    │
│  │  └──────────────┘  └──────────────┘    │    │
│  │                                         │    │
│  │  内置: SessionBinder / UsageTracker     │    │
│  │        SmartRouter / ConcurrencyMgr     │    │
│  └─────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

**概念映射**：
- 原来的 **"Account"** = 现在的 **"Key"**（API Key + 配额/并发配置）
- 原来的 **"Pool"** = 现在的 **"KeyPool"**（Provider 内部的 Key 调度器）
- **Provider** 不变，但现在内含 KeyPool

### 3.4 请求处理流程

```
请求进入
  │
  ▼
Router: 路由到 Provider "zai"      ← 正常路由，不再有 Pool 特殊分支
  │
  ▼
handleTransformerEndpoint:
  │
  ├─ provider = getProvider("zai")  ← 完整 Provider（有 Transformer 链）
  │
  ├─ provider._keyPool 存在？
  │   ▼ 是
  │   keyPool.selectKey(sessionId)
  │   ├─ SessionBinder: 有绑定？→ 用绑定的 key
  │   ├─ SmartRouter: 加权评分，选最优 key
  │   ├─ ConcurrencyManager: acquireSlot()
  │   └─ UsageTracker: 检查 5h/周用量
  │
  │   返回 { apiKey: "sk-key-2", keyId: "key-2" }
  │
  ├─ effectiveProvider = { ...provider, apiKey: "sk-key-2" }
  │
  ├─ Transformer 链 ✅  /  Auth ✅  /  Model Mapping ✅
  │
  ▼
sendRequestToProvider → 上游 API
  │
  ▼ 响应返回
onResponse hook:
  ├─ keyPool.releaseKey(keyId)       ← 释放并发槽位
  ├─ usageTracker.recordRequest()    ← 更新使用量统计
  └─ smartRouter.recordRequest()     ← 更新健康追踪
```

---

## 4. Phase 3 功能映射

### 4.1 功能继承清单

| Phase 3 模块 | 行数 | 新架构去向 | 策略 |
|---|---|---|---|
| `ConcurrencyManager` | 334 | 内嵌到 `KeyPool` | **复用**，`accountId` → `keyId` |
| `SessionBinder` | 344 | 内嵌到 `KeyPool` | **复用**，session→keyId 绑定 |
| `UsageTracker` | 333 | 内嵌到 `KeyPool` | **复用**，per-key 5h/周滚动计数 |
| `SmartRouter` | 397 | 挂载到 `KeyPool` | **复用**，加权评分 + 健康追踪 |
| `AlertService` | 640 | 传入 KeyPool 状态 | **适配**，数据源改为 KeyPool |
| `UsageHistoryService` | 549 | 传入 KeyPool 数据 | **复用**，快照 + 趋势分析 |
| `BindingStorage` | ~200 | 不变 | **复用** |
| `PoolStorage` | 473 | Provider 配置承接 | **替代**，标记 deprecated |
| `PoolRouter` | 362 | 合并到 KeyPool | **替代** |
| `PoolManager` | 583 | 合并到 KeyPool | **替代** |

### 4.2 并发控制

和 Phase 3 完全一样，粒度从 "Account" 改为 "Key"：
- 每个 Key 有 `maxConcurrency`（如 3）
- `selectKey()` 时 `acquireSlot(keyId, sessionId)`，满则跳过
- 响应完成后 `releaseKey()` 释放
- Zombie 连接清理（heartbeat check）保留

### 4.3 使用量统计

和 Phase 3 完全一样，`UsageTracker` 直接复用：
- 每次请求完成后 `recordRequest(keyId, { estimatedTokens })`
- 内部维护滚动窗口：5 小时 / 周 token 用量
- 选 Key 时检查 `usage / limit > 1 - bufferRatio` → 跳过
- AlertService 定期扫描，达阈值触发告警

---

## 5. 实现计划

### 5.1 文件改动清单

#### 类型层
- **[MODIFY]** `packages/core/src/types/llm.ts`
  - `LLMProvider` 增加 `keyPool?: ProviderKeyConfig[]`
  - `ConfigProvider` 增加 `key_pool?: ConfigKeyEntry[]`
  - 新增 `ProviderKeyConfig` 接口

#### 新服务
- **[NEW]** `packages/core/src/services/key-pool.ts`
  - 整合 PoolManager + PoolRouter + ConcurrencyManager 核心逻辑
  - 内部组合复用 SessionBinder、UsageTracker、SmartRouter

#### Provider 层
- **[MODIFY]** `packages/core/src/services/provider.ts`
  - 解析 `key_pool` 配置，实例化 KeyPool 挂载到 Provider

#### 请求处理层
- **[MODIFY]** `packages/core/src/api/routes.ts`
  - 删除 L46-L66 临时 Provider 构建
  - 删除 L370 `_platform` hack
  - 新增 KeyPool 选 Key 逻辑

#### Router 层
- **[MODIFY]** `packages/core/src/utils/router.ts`
  - 删除 `initPoolRouter`、`getPoolRouter` 全局实例
  - 删除 `getUseModel` 中 Pool 特殊分支

#### Server 层
- **[MODIFY]** `packages/core/src/server.ts`
  - 删除 `initPoolRouter()` 调用
  - `onResponse` hook 改为从 Provider._keyPool 释放 Key

#### Pool API 端点（保留 + 适配）
- **[MODIFY]** `packages/core/src/api/routes.ts` — Pool API 部分
  - `GET /pool/status` → 遍历所有 Provider._keyPool 聚合状态
  - `GET /pool/bindings` → 从 _keyPool.getSessionBinder() 获取
  - `POST /pool/bindings/clear` → 调用 _keyPool.resetAll()
  - 其余 Pool API 类似适配

### 5.2 配置格式

```jsonc
{
  "providers": [
    {
      "name": "zai",
      "api_base_url": "https://api.z.ai/api/anthropic",
      "api_key": "sk-primary-key",
      "models": ["claude-sonnet-4-20250514"],
      "key_pool": [
        {
          "name": "Account-1",
          "api_key": "sk-key-1",
          "max_concurrency": 3,
          "last_5_hours_limit": 100000,
          "weekly_limit": 500000
        },
        {
          "name": "Account-2",
          "api_key": "sk-key-2",
          "max_concurrency": 3,
          "last_5_hours_limit": 100000,
          "weekly_limit": 500000
        }
      ],
      "transformer": { "use": ["anthropic"] }
    }
  ]
}
```

不再需要单独的 `CodingPlanPool` 配置节。

### 5.3 迁移策略

- 首次启动时检测旧 `~/.claude-code-router/pool-config.json`
- 存在则读取账号列表，写入对应 Provider 的 `key_pool`
- 迁移后将旧文件重命名为 `.bak`

### 5.4 Phase 3 代码处理

- `session-binder.ts`、`usage-tracker.ts`、`concurrency-manager.ts` — **保持不动**，被 KeyPool import 复用
- `alerts.ts`、`smart-router.ts`、`usage-history.ts` — **保持不动**，适配入参
- `pool-manager.ts`、`pool-router.ts` — 核心算法合并到 `key-pool.ts`，旧文件标记 `@deprecated`

---

## 6. 验收标准

- [ ] Provider 配置 `key_pool` 后，请求走完整 Transformer 链
- [ ] Model Mapping 对 Pool 请求生效
- [ ] Auth 正常工作，无 `_platform` hack
- [ ] 并发控制正常（per-key maxConcurrency）
- [ ] 使用量统计正常（5h/周 滚动窗口）
- [ ] Session 绑定正常（同 session 绑定同 key）
- [ ] Pool Status API 返回正确数据
- [ ] 告警服务正常触发
- [ ] 现有单元测试通过
- [ ] 新增 `key-pool.test.ts` 测试通过
