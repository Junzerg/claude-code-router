# Phase 1: 基础架构开发计划

**版本**: v1.8
**预计工期**: 2-3 天
**状态**: Phase 1 已完成 ✅
**更新时间**: 2026-03-10

---

## 目标

实现账号池基础功能和并发控制，支持动态添加/删除账号。

---

## 任务列表

| 序号 | 任务 | 预计时间 | 输出文件 | 依赖 | 状态 |
|------|------|----------|----------|------|------|
| 1.1 | 定义 `CodingPlanAccount` 接口 | 0.5h | `packages/core/src/types/pool.ts` | - | ✅ 已完成 |
| 1.2 | 实现 `PoolManager` 管理类 | 2h | `packages/core/src/services/pool-manager.ts` | 1.1 | ✅ 已完成 |
| 1.3 | 实现并发槽位管理 | 2h | `packages/core/src/services/concurrency-manager.ts` | 1.2 | ✅ 已完成 |
| 1.4 | CLI: `ccr pool add` | 2h | `packages/cli/src/commands/pool-add.ts` | 1.2 | ✅ 已完成 |
| 1.5 | CLI: `ccr pool remove` | 1h | `packages/cli/src/commands/pool-remove.ts` | 1.4 | ✅ 已完成 |
| 1.6 | CLI: `ccr pool list` | 1h | `packages/cli/src/commands/pool-list.ts` | 1.2 | ✅ 已完成 |
| 1.7 | CLI: `ccr pool status` | 1h | `packages/cli/src/commands/pool-status.ts` | 1.2 | ✅ 已完成 |
| 1.8 | 集成到现有路由系统 | 2h | `packages/core/src/utils/router.ts` | 1.2, 1.3 | ✅ 已完成 |

---

## 开发顺序

```
1.1 定义接口 → 1.2 实现 Pool 管理类 → 1.3 并发控制
                                          ↓
1.8 路由集成 ← 1.7 CLI status ← 1.6 CLI list ← 1.4 CLI add → 1.5 CLI remove
```

---

## 验收标准

- [x] 可以动态添加/删除账号
- [x] 并发槽位正确获取和释放
- [x] 命令行可以查看账号状态
- [x] 路由系统能够选择账号

---

## 相关文件

- [主计划](../coding-plan-pool-implementation-plan.md)
- [详细需求](../../requirements/coding-plan-pool-management.md)
