# Task 3.2: 绑定持久化

**优先级**: P0
**预计时间**: 2 小时
**依赖**: Task 3.1 完成
**状态**: ✅ 已完成

---

## 功能说明

实现 Session Binding 的持久化存储，确保服务重启后能够恢复会话绑定关系。

### 核心需求

1. **JSON 文件存储**: 将 Session Binding 保存到 JSON 文件
2. **自动加载**: 服务启动时自动加载已保存的绑定
3. **自动保存**: 绑定变化后自动保存到文件
4. **TTL 检查**: 加载时跳过已过期的绑定
5. **备份管理**: 保留最近 N 个备份文件

---

## 实现文件

### 新增文件

- `packages/core/src/services/binding-storage.ts` - 绑定持久化服务

### 修改文件

- `packages/core/src/utils/router.ts` - 集成 BindingStorage

---

## 核心实现

### BindingStorage 类

```typescript
export class BindingStorage {
  /**
   * 加载绑定文件
   */
  async load(): Promise<boolean>;

  /**
   * 保存绑定到文件
   */
  async save(): Promise<boolean>;

  /**
   * 启动自动保存
   */
  startAutoSave(): void;

  /**
   * 标记绑定为脏数据（需要保存）
   */
  markDirty(): void;

  /**
   * 停止自动保存并执行最终保存
   */
  destroy(): void;

  /**
   * 包装 SessionBinder 方法，自动标记保存
   */
  wrapSessionBinder(): void;
}
```

### SessionBinder 集成

```typescript
// 在 initPoolRouter 中初始化
const sessionBinder = poolRouterInstance.getSessionBinder();
bindingStorageInstance = createBindingStorage(sessionBinder);

// createBindingStorage 自动：
// 1. 加载已保存的绑定
// 2. 启动自动保存
// 3. 包装 SessionBinder 的 bind/unbind 方法
```

### 存储文件格式

```json
{
  "version": "1.0.0",
  "lastSavedAt": "2026-03-10T12:00:00.000Z",
  "bindings": [
    {
      "sessionId": "conv_abc123def456",
      "accountId": "cp-1710000001",
      "createdAt": "2026-03-10T10:00:00.000Z",
      "lastActiveAt": "2026-03-10T11:30:00.000Z",
      "updatedAt": "2026-03-10T11:30:00.000Z",
      "ttlMinutes": 60
    }
  ]
}
```

---

## 存储位置

**默认存储文件路径**: `~/.claude-code-router/binding-storage.json`

**备份文件**: `~/.claude-code-router/binding-storage.json.backup.<timestamp>`

**备份数量**: 保留最近 3 个备份

---

## 自动保存机制

1. **触发时机**: SessionBinder 的以下操作会触发保存标记：
   - `bind(sessionId, accountId)` - 创建绑定
   - `unbind(sessionId)` - 删除绑定

2. **定时保存**: 每 30 秒检查一次，如果有未保存的更改则执行保存

3. **原子写入**: 使用临时文件 + 重命名方式，防止写入失败导致文件损坏

4. **TTL 检查**: 加载时自动跳过已过期的绑定（基于 lastActiveAt + ttlMinutes）

---

## 集成方式

```typescript
// router.ts - initPoolRouter 函数
import { BindingStorage, createBindingStorage } from "../services/binding-storage";

// 创建 BindingStorage
const sessionBinder = poolRouterInstance.getSessionBinder();
bindingStorageInstance = createBindingStorage(sessionBinder);

// createBindingStorage 内部完成：
// 1. 加载已保存的绑定（如果文件存在）
// 2. 启动自动保存定时器
// 3. 包装 SessionBinder 的 bind/unbind 方法
```

---

## 验收标准

- [x] 服务启动时自动加载绑定文件 ✅
- [x] 绑定文件不存在时不报错 ✅
- [x] 绑定变化后自动保存 ✅
- [x] 自动创建备份文件 ✅
- [x] 备份文件数量限制 ✅
- [x] 加载时跳过过期绑定 ✅
- [x] 原子写入防止损坏 ✅
- [x] 构建验证通过 ✅

---

## 相关文件

- [Phase 3 计划](./README.md)
- [Task 3.1: 配置持久化](./task-3.1-persistence.md)
- [主计划](../coding-plan-pool-implementation-plan.md)

---

## 下一步

继续 Task 3.3: UI 用量面板，实现 Web 界面的账号池状态展示。

**Task 3.2 完成时间**: 2026-03-10
**状态**: ✅ 已完成
