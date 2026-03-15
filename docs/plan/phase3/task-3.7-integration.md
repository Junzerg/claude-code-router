# Task 3.7: Phase 3 服务集成

**优先级**: P0（Phase 3 能否生效的关键）
**预计时间**: 8 小时
**依赖**: Task 3.1 ~ 3.6 代码已完成
**状态**: ✅ 已完成
**完成时间**: 2026-03-14

---

## 背景

Task 3.1 ~ 3.6 的服务类代码已全部写完，但这些服务**没有在程序启动时被初始化**，也**没有对应的 HTTP 接口**。  
本任务是 Phase 3 真正生效的最后一步。

---

## 子任务 3.7.1：在启动入口初始化 Phase 3 服务 ✅

**实际状态**：代码已存在，实际工期 0h（前任已完成）

`packages/core/src/server.ts` 的 `Server` 构造函数第 103 行已调用 `initPoolRouter(this.configService)`，
`initPoolRouter` 内部已完整初始化所有 Phase 3 服务：
- ✅ `createPoolStorage(poolManager)` — 持久化，含 `loadSync()` 加载已有配置
- ✅ `createBindingStorage(sessionBinder)` — 绑定持久化
- ✅ `createAlertService(poolManager)` — 告警服务（已 start()）
- ✅ `createUsageHistoryService(...)` — 历史统计（已 start(5)）
- ✅ `createSmartRouter(usageHistoryServiceInstance)` + `poolRouter.setSmartRouter(...)` — 智能路由已接入

此外，`core/src/server.ts` 新增了对外导出（本次工作添加）：
```typescript
export { getPoolRouter, getAlertService, getUsageHistoryService, getSmartRouter } from "./utils/router";
```

---

## 子任务 3.7.2：在 server.ts 添加 Pool HTTP 接口 ✅

**实际工期**：约 1.5h

**完成方式**：在 `packages/server/src/server.ts` 中新增 6 条路由：
- `GET /api/pool/status` — 账号池汇总状态
- `GET /api/pool/bindings` — 会话绑定列表
- `DELETE /api/pool/bindings` — 清除所有绑定
- `DELETE /api/pool/bindings/:sessionId` — 删除单条绑定
- `GET /api/pool/alerts` — 告警历史
- `GET /api/pool/history/:accountId` — 账号历史用量

路由通过 `getPoolRouter()`、`getAlertService()`、`getUsageHistoryService()` 获取服务实例，所有实例来自 `@musistudio/llms` 包的全局单例，与 Server 构造函数中初始化的同一组实例。

---

## 子任务 3.7.3：在 api.ts 补充客户端方法 ✅

**实际状态**：代码已存在，只修正了 HTTP 方法（0.5h）

`packages/ui/src/lib/api.ts` 已有完整的 Pool API 方法（前任已添加 `// ========== Pool API methods ==========` 段）。
本次修正了两处 HTTP 方法与 server.ts 路由不一致的问题：
- `clearPoolBindings()`：从 `POST /pool/bindings/clear` 改为 `DELETE /pool/bindings`
- `removePoolBinding(sessionId)`：从 `POST /pool/bindings/remove?sessionId=...` 改为 `DELETE /pool/bindings/:sessionId`

---

## 验收标准

- [x] 服务重启后账号配置不丢失 ✅（PoolStorage 在服务启动时 loadSync）
- [x] 服务重启后有效的会话绑定不丢失（已过期的自动丢弃）✅（BindingStorage load 时过滤过期条目）
- [x] SmartRouter 正常工作 ✅（已通过 poolRouter.setSmartRouter 接入）
- [x] 告警服务启动 ✅（AlertService 在 initPoolRouter 中创建并 start()）
- [x] 历史统计启动 ✅（UsageHistoryService 在 initPoolRouter 中 start(5)）
- [x] 访问 UI 面板 `Pool Status` 页面不报错 ✅（2026-03-15 运行时验证通过，含 Last Used 修复）
- [x] 清除绑定按钮正常工作 ✅（2026-03-15 运行时验证通过，绑定清除后列表归零）

**构建验证**：✅ `pnpm --filter @musistudio/llms build` 成功，dist 产物中包含 `getPoolRouter`、`getAlertService` 等导出。

---

## 相关文件

- [Phase 3 计划](./README.md)
- [Task 3.1 配置持久化](./task-3.1-persistence.md)
- [Task 3.2 绑定持久化](./task-3.2-binding-persistence.md)
- [Task 3.3 UI 面板](./task-3.3-ui-dashboard.md)
- [Task 3.4-3.6 告警/历史/智能路由](./task-3.4-3.6-alerts-history-smart.md)
