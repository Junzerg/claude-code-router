# Coding Plan 账号池化实现计划

**创建日期**: 2026-03-09
**版本**: v1.0
**状态**: 待开发

---

## 项目目标

将 20 个 Z.ai Coding Plan 账号共享给 80 名员工使用，实现账号池化管理，包括：
- 用量监控与并发控制
- 错误自动切换
- 会话上下文保持（前缀缓存优化）

---

## 核心架构

```
┌─────────────────────────────────────────────────────────────┐
│              Claude Code Router Server                      │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Account Pool Manager                     │  │
│  │  - accounts: Map<accountId, CodingPlanAccount>        │  │
│  │  - sessionBindings: Map<sessionId, accountId>         │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Smart Router                             │  │
│  │  1. 检查会话绑定 → 2. 检查并发槽位 → 3. 检查用量      │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              CLI Commands                             │  │
│  │  ccr pool add/remove/list/status/binding              │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 实现阶段

### Phase 1: 基础架构 (2-3 天)

**目标**: 实现账号池基础功能和并发控制

| 任务 | 文件位置 | 优先级 |
|------|----------|--------|
| 定义 `CodingPlanAccount` 接口 | `packages/core/src/types/pool.ts` | P0 |
| 实现 `AccountPool` 管理类 | `packages/core/src/services/pool.ts` | P0 |
| 实现并发槽位管理 | `packages/core/src/services/concurrency.ts` | P0 |
| CLI: `ccr pool add` | `packages/cli/src/commands/pool-add.ts` | P0 |
| CLI: `ccr pool remove` | `packages/cli/src/commands/pool-remove.ts` | P0 |
| CLI: `ccr pool list` | `packages/cli/src/commands/pool-list.ts` | P0 |
| CLI: `ccr pool status` | `packages/cli/src/commands/pool-status.ts` | P1 |

**验收标准**:
- [ ] 可以动态添加/删除账号
- [ ] 并发槽位正确获取和释放
- [ ] 命令行可以查看账号状态

---

### Phase 2: 核心功能 (3-5 天)

**目标**: 实现会话绑定、错误切换和用量管理

| 任务 | 文件位置 | 优先级 |
|------|----------|--------|
| 会话绑定管理器 | `packages/core/src/services/session-binder.ts` | P0 |
| 基于 conversation_id 的会话识别 | `packages/core/src/utils/session.ts` | P0 |
| 错误识别与自动切换 | `packages/core/src/services/error-handler.ts` | P0 |
| Z.ai 用量 API 调用 | `packages/core/src/api/zai-usage.ts` | P0 |
| 定时用量同步 | `packages/core/src/services/usage-sync.ts` | P1 |
| 本地用量统计 | `packages/core/src/services/usage-tracker.ts` | P1 |

**验收标准**:
- [ ] 同一用户会话固定使用同一账号
- [ ] 遇到限流错误自动切换到其他账号
- [ ] 定时同步 Z.ai 用量数据

---

### Phase 3: 增强功能 (3-5 天)

**目标**: 状态持久化、监控告警和 UI 集成

| 任务 | 文件位置 | 优先级 |
|------|----------|--------|
| 账号配置持久化 | `packages/core/src/services/pool-storage.ts` | P1 |
| 用量面板 (UI) | `packages/ui/src/pages/PoolStatus.tsx` | P2 |
| 账号受限告警 | `packages/core/src/services/alerts.ts` | P2 |
| 历史用量统计 | `packages/core/src/services/usage-history.ts` | P2 |

**验收标准**:
- [ ] 重启后恢复账号配置和会话绑定
- [ ] UI 可以查看用量面板
- [ ] 账号受限时发送告警通知

---

## 配置格式

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
    ],
    "settings": {
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
        "intervalMinutes": 5
      }
    }
  }
}
```

---

## Z.ai API 参考

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/monitor/usage/model-usage` | GET | 模型用量统计 |
| `/api/monitor/usage/tool-usage` | GET | 工具用量统计 |
| `/api/monitor/usage/quota/limit` | GET | 配额限制信息 |

**认证**: `Authorization: <ANTHROPIC_AUTH_TOKEN>`

---

## 待确认事项

| 事项 | 负责人 | 状态 |
|------|--------|------|
| Z.ai 错误码格式 | 开发团队 | ⏳ 待测试 |
| 并发超限错误响应 | 开发团队 | ⏳ 待测试 |
| 用量 API 响应字段 | 开发团队 | ⏳ 待测试 |

---

## 下一步行动

1. [ ] 测试 Z.ai API 错误响应格式
2. [ ] 创建 Phase 1 开发任务
3. [ ] 开始编码实现

---

## 相关文档

- [详细需求讨论](../requirements/coding-plan-pool-management.md)
- [Z.ai Coding Plan 文档](https://docs.bigmodel.cn/cn/coding-plan/quick-start)
- [Z.ai Coding Plugins](https://github.com/zai-org/zai-coding-plugins)
