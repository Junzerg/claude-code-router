# Coding Plan 账号池化实现计划

**版本**: v3.9
**创建日期**: 2026-03-09
**状态**: Phase 1 已完成 ✅, Phase 2 已完成 ✅, Phase 3 已完成 ✅
**更新时间**: 2026-03-10

---

## 项目目标

将 20 个 Z.ai Coding Plan 账号共享给 80 名员工使用，实现账号池化管理。

**三大核心需求**:

| 需求 | 解决方案 | 阶段 |
|------|----------|------|
| 用量池化 + 并发控制 | 定时调用 Z.ai 用量 API + 内存级并发槽位管理 | Phase 1 |
| 错误自动切换 | 识别限流错误 + 请求重试 + 账号切换 | Phase 2 |
| 会话上下文保持 | 基于 conversation_id 的会话绑定机制 | Phase 2 |

---

## 阶段划分

### Phase 1: 基础架构 (2-3 天)

**目标**: 实现账号池基础功能和并发控制

- [x] [Task 1.1](./phase1/task-1.1-types.md) 定义类型接口 ✅
- [x] [Task 1.2](./phase1/task-1.2-pool-manager.md) 实现 PoolManager ✅
- [x] [Task 1.3](./phase1/task-1.3-concurrency-manager.md) 并发槽位管理 ✅
- [x] [Task 1.4](./phase1/task-1.4-cli-add.md) CLI: pool add ✅
- [x] [Task 1.5](./phase1/task-1.5-1.7-cli-other.md) CLI: pool remove ✅
- [x] [Task 1.6](./phase1/task-1.5-1.7-cli-other.md) CLI: pool list ✅
- [x] [Task 1.7](./phase1/task-1.5-1.7-cli-other.md) CLI: pool status ✅
- [x] [Task 1.8](./phase1/task-1.8-router-integration.md) 路由集成 ✅

**验收标准**:
- [x] 可以动态添加/删除账号
- [x] 并发槽位正确获取和释放
- [x] 命令行可以查看账号列表
- [x] 命令行可以查看账号详情
- [x] 路由系统能够选择账号

📋 [Phase 1 详细计划](./phase1/README.md)

---

### Phase 2: 核心功能 (3-5 天)

**目标**: 实现会话绑定、错误切换和用量管理

- [x] [Task 2.1-2.2](./phase2/task-2.1-2.2-session-binding.md) 会话绑定管理 ✅
- [x] [Task 2.3](./phase2/task-2.3-error-handler.md) 错误识别与切换 ✅
- [x] [Task 2.4-2.5](./phase2/task-2.4-2.5-usage.md) Z.ai 用量 API ✅
- [x] [Task 2.6](./phase2/task-2.6-2.7-local-tracking-cli.md) 本地用量统计 ✅
- [x] [Task 2.7](./phase2/task-2.6-2.7-local-tracking-cli.md) CLI: `ccr pool binding` ✅

**验收标准**:
- [x] 同一用户会话固定使用同一账号
- [x] 定时同步 Z.ai 用量数据
- [x] 遇到限流错误自动切换到其他账号
- [x] 本地统计请求计数
- [x] CLI 可以管理会话绑定
- [x] 本地统计请求计数

📋 [Phase 2 详细计划](./phase2/README.md)

---

### Phase 3: 增强功能 (3-5 天)

**目标**: 状态持久化、监控告警和 UI 集成

- [x] [Task 3.1](./phase3/task-3.1-persistence.md) 配置持久化 ✅
- [x] [Task 3.2](./phase3/task-3.2-binding-persistence.md) 绑定持久化 ✅
- [x] [Task 3.3](./phase3/task-3.3-ui-dashboard.md) 用量面板 UI ✅
- [x] [Task 3.4](./phase3/task-3.4-alerts.md) 账号受限告警 ✅
- [x] [Task 3.5](./phase3/task-3.5-usage-history.md) 历史用量统计 ✅
- [x] [Task 3.6](./phase3/task-3.6-smart-router.md) 高级路由策略 ✅

**验收标准**:
- [x] 重启后恢复账号配置 ✅
- [x] 重启后恢复会话绑定 ✅
- [x] UI 可以查看用量面板 ✅
- [x] 账号受限时发送告警通知 ✅
- [x] 历史用量记录可查询 ✅
- [x] 智能路由选择最优账号 ✅

📋 [Phase 3 详细计划](./phase3/README.md)

---

## 开发顺序

```
Phase 1 (基础)
  └─ 1.1 类型定义
       └─ 1.2 PoolManager
            ├─ 1.3 并发控制
            ├─ 1.4 CLI add
            ├─ 1.5 CLI remove
            ├─ 1.6 CLI list
            ├─ 1.7 CLI status
            └─ 1.8 路由集成

Phase 2 (核心)
  ├─ 2.2 会话 ID 识别
  │    └─ 2.1 SessionBinder
  │              └─ 2.7 CLI binding
  ├─ 2.4 Z.ai API
  │    └─ 2.5 用量同步
  │           └─ 2.6 本地统计
  └─ 2.3 错误处理 (依赖 Phase 1)

Phase 3 (增强)
  ├─ 3.1 配置持久化
  │    └─ 3.2 绑定持久化
  ├─ 3.4 告警服务
  │    └─ 3.3 UI 面板
  └─ 3.5 历史统计
       └─ 3.6 智能路由
```

---

## 文件结构

```
packages/
├── core/
│   ├── src/
│   │   ├── types/
│   │   │   └── pool.ts                    # Task 1.1
│   │   ├── services/
│   │   │   ├── pool-manager.ts            # Task 1.2
│   │   │   ├── concurrency-manager.ts     # Task 1.3
│   │   │   ├── session-binder.ts          # Task 2.1
│   │   │   ├── error-handler.ts           # Task 2.3
│   │   │   ├── usage-sync.ts              # Task 2.5
│   │   │   ├── usage-tracker.ts           # Task 2.6
│   │   │   ├── pool-storage.ts            # Task 3.1
│   │   │   ├── binding-storage.ts         # Task 3.2
│   │   │   ├── alerts.ts                  # Task 3.4
│   │   │   ├── usage-history.ts           # Task 3.5
│   │   │   └── smart-router.ts            # Task 3.6
│   │   ├── api/
│   │   │   └── zai-usage.ts               # Task 2.4
│   │   ├── utils/
│   │   │   ├── session-id.ts              # Task 2.2
│   │   │   └── router.ts                  # Task 1.8 (修改)
│   │   └── services/pool-router.ts        # Task 1.8
│   └── ...
├── cli/
│   └── src/
│       └── commands/
│           ├── pool-add.ts                # Task 1.4
│           ├── pool-remove.ts             # Task 1.5
│           ├── pool-list.ts               # Task 1.6
│           ├── pool-status.ts             # Task 1.7
│           └── pool-binding.ts            # Task 2.7
└── ui/
    └── src/
        ├── pages/
        │   └── PoolStatus.tsx             # Task 3.3
        └── api/
            └── pool.ts                    # Task 3.3 API 客户端
```

---

## API 参考

### Z.ai 用量查询 API

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/monitor/usage/model-usage` | GET | 模型用量统计 |
| `/api/monitor/usage/tool-usage` | GET | 工具用量统计 |
| `/api/monitor/usage/quota/limit` | GET | 配额限制信息 |

**认证**: `Authorization: <ANTHROPIC_AUTH_TOKEN>`

---

## 相关文档

- [详细需求讨论](../requirements/coding-plan-pool-management.md)
- [Z.ai Coding Plan 文档](https://docs.bigmodel.cn/cn/coding-plan/quick-start)
- [Z.ai Coding Plugins](https://github.com/zai-org/zai-coding-plugins)

---

## 下一步行动

1. [x] 开始 Phase 1 开发
2. [x] Task 1.1: 定义类型接口 ✅
3. [x] Task 1.2: 实现 PoolManager ✅
4. [x] Task 1.3: 实现 ConcurrencyManager ✅
5. [x] Task 1.4: CLI pool add 命令 ✅
6. [x] Task 1.5: CLI pool remove 命令 ✅
7. [x] Task 1.6: CLI pool list 命令 ✅
8. [x] Task 1.7: CLI pool status 命令 ✅
9. [x] Task 1.8: 路由集成 ✅
10. [x] Phase 2: 核心功能开发
    - [x] Task 2.1-2.2: 会话绑定管理 ✅
    - [x] Task 2.3: 错误识别与切换 ✅
    - [x] Task 2.4-2.5: Z.ai 用量 API ✅
    - [x] Task 2.6: 本地用量统计 ✅
    - [x] Task 2.7: CLI binding 命令 ✅
11. [ ] 创建开发分支 `feature/coding-plan-pool`
12. [ ] Phase 3: 增强功能（持久化、UI、告警）
