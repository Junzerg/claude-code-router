# Phase 2: 核心功能开发计划

**版本**: v1.5
**预计工期**: 3-5 天
**状态**: Phase 2 所有任务已完成 ✅
**更新时间**: 2026-03-10

---

## 目标

实现会话绑定、错误自动切换和用量管理的核心功能。

---

## 任务列表

| 序号 | 任务 | 预计时间 | 输出文件 | 依赖 | 状态 |
|------|------|----------|----------|------|------|
| 2.1 | 会话绑定管理器 | 2h | `packages/core/src/services/session-binder.ts` | Phase 1 | ✅ 已完成 |
| 2.2 | 会话 ID 识别工具 | 1h | `packages/core/src/utils/session-id.ts` | - | ✅ 已完成 |
| 2.3 | 错误识别与自动切换 | 3h | `packages/core/src/services/error-handler.ts` | Phase 1 | ✅ 已完成 |
| 2.4 | Z.ai 用量 API 调用 | 2h | `packages/core/src/api/zai-usage.ts` | - | ✅ 已完成 |
| 2.5 | 定时用量同步 | 2h | `packages/core/src/services/usage-sync.ts` | 2.4 | ✅ 已完成 |
| 2.6 | 本地用量统计 | 2h | `packages/core/src/services/usage-tracker.ts` | - | ✅ 已完成 |
| 2.7 | CLI: `ccr pool binding` | 1h | `packages/cli/src/commands/pool-binding.ts` | 2.1 | ✅ 已完成 |

---

## 开发顺序

```
2.2 会话 ID 识别 → 2.1 会话绑定管理器 → 2.7 CLI binding
                         ↓
2.4 用量 API → 2.5 用量同步 → 2.6 本地统计
                ↓
         2.3 错误处理与切换
```

---

## 验收标准

- [x] 同一用户会话固定使用同一账号
- [x] 会话绑定 TTL 过期后自动释放
- [x] 遇到限流错误自动切换到其他账号
- [x] 定时同步 Z.ai 用量数据
- [x] 本地统计请求计数

---

## 相关文件

- [Phase 1 完成](../phase1/README.md)
- [主计划](../coding-plan-pool-implementation-plan.md)
- [详细需求](../../requirements/coding-plan-pool-management.md)
