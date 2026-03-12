# Phase 1 开发启动 Prompt

复制以下内容到新会话中：

---

```
我要开发 Claude Code Router 的 Coding Plan 账号池化功能，现在是 Phase 1：基础架构开发。

## 项目背景

将 20 个 Z.ai Coding Plan 账号共享给 80 名员工使用，需要实现：
- 账号池化管理（动态添加/删除）
- 并发控制（每个账号默认 3 并发）
- 会话绑定（保持上下文缓存）
- 错误自动切换

## 项目结构

```
packages/
├── cli/          # 命令行工具
├── core/         # 核心逻辑 (本次开发重点)
├── server/       # 服务器层
├── shared/       # 共享工具
└── ui/           # Web 界面
```

## Phase 1 任务列表

请按照以下顺序帮我实现每个任务：

### Task 1.1: 定义类型接口
- 文件：`packages/core/src/types/pool.ts`
- 定义：AccountStatus, ConcurrencyState, UsageState, CodingPlanAccount, AccountPoolConfig 等接口

### Task 1.2: 实现 PoolManager
- 文件：`packages/core/src/services/pool-manager.ts`
- 实现：账号的增删改查、可用性检查、状态管理

### Task 1.3: 实现 ConcurrencyManager
- 文件：`packages/core/src/services/concurrency-manager.ts`
- 实现：并发槽位的获取/释放、僵尸连接清理

### Task 1.4-1.7: CLI 命令
- `packages/cli/src/commands/pool-add.ts` - 添加账号
- `packages/cli/src/commands/pool-remove.ts` - 删除账号
- `packages/cli/src/commands/pool-list.ts` - 列出账号
- `packages/cli/src/commands/pool-status.ts` - 查看状态

### Task 1.8: 路由集成
- 文件：`packages/core/src/services/pool-router.ts`
- 集成到现有路由系统

## 开发要求

1. **TypeScript**: 使用严格类型，定义完整的接口
2. **代码风格**: 与现有代码保持一致（查看 packages/core/src 现有文件）
3. **注释**: 英文注释，使用 JSDoc 格式
4. **错误处理**: 完善的错误处理和日志记录
5. **单元测试**: 为每个核心函数编写测试

## 参考资料

详细设计文档：
- `docs/plan/phase1/README.md` - Phase 1 概览
- `docs/plan/phase1/task-*.md` - 每个任务的详细设计

开始开发前，请先：
1. 读取 `packages/core/src/types/` 目录了解现有类型定义风格
2. 读取 `packages/core/src/services/` 了解现有服务实现风格
3. 读取 `packages/cli/src/commands/` 了解 CLI 命令实现风格

然后从 Task 1.1 开始，逐个任务实现。每完成一个任务，请告诉我验收测试结果，然后再进行下一个任务。

现在开始 Task 1.1，请先读取现有的类型定义文件，然后创建 `packages/core/src/types/pool.ts`。
```

---

## 使用说明

1. **复制上面的 prompt** 到新会话
2. **AI 会先读取现有代码**了解风格
3. **逐个任务实现**，每个任务完成后验收
4. **遇到问题**AI 会主动询问你

## 如果你想要更激进的版本

想要更快的开发节奏，可以在 prompt 末尾添加：

```
另外，请一次性生成 Task 1.1-1.3 的核心代码，我会一起审查和测试。
```

## 如果你想要更保守的版本

想要更稳妥的开发节奏，可以在 prompt 末尾添加：

```
请一个任务一个任务地进行，每个任务完成后等待我的确认再继续下一个。
```
