# Task 3.1: 配置持久化

**优先级**: P0
**预计时间**: 2 小时
**依赖**: Phase 1 完成
**状态**: ✅ 已完成

---

## 功能说明

实现 Pool 配置的持久化存储，确保服务重启后能够恢复账号池配置。

### 核心需求

1. **JSON 文件存储**: 将 Pool 配置保存到 JSON 文件
2. **自动加载**: 服务启动时自动加载已保存的配置
3. **自动保存**: 配置修改后自动保存到文件
4. **备份管理**: 保留最近 N 个备份文件

---

## 实现文件

### 新增文件

- `packages/core/src/services/pool-storage.ts` - 配置持久化服务

### 修改文件

- `packages/core/src/services/pool-manager.ts` - 添加 onSave 回调
- `packages/core/src/utils/router.ts` - 集成 PoolStorage

---

## 核心实现

### PoolStorage 类

```typescript
export class PoolStorage {
  /**
   * 加载配置文件
   */
  async load(): Promise<boolean>;

  /**
   * 保存配置到文件
   */
  async save(): Promise<boolean>;

  /**
   * 启动自动保存
   */
  startAutoSave(): void;

  /**
   * 标记配置为脏数据（需要保存）
   */
  markDirty(): void;

  /**
   * 停止自动保存并执行最终保存
   */
  destroy(): void;
}
```

### PoolManager 集成

```typescript
// 添加 onSave 回调
constructor(config?: Partial<AccountPoolConfig>, onSave?: SaveCallback);

// 在修改操作时触发保存
private triggerSave(): void {
  if (this.onSave) {
    this.onSave();
  }
}
```

### 配置文件格式

```json
{
  "version": "1.0.0",
  "lastSavedAt": "2026-03-10T12:00:00.000Z",
  "pool": {
    "enabled": true,
    "defaultMaxConcurrency": 3,
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
    },
    "accounts": [
      {
        "id": "cp-1234567890-abc",
        "name": "Account 1",
        "platform": "zai",
        "apiKey": "sk-xxx",
        "apiBaseUrl": "https://api.z.ai",
        "status": "active",
        "config": {
          "maxConcurrency": 3,
          "last5HoursLimit": 100000,
          "weeklyLimit": 500000,
          "bufferRatio": 0.1
        },
        "metadata": {
          "createdAt": "2026-03-10T10:00:00.000Z",
          "updatedAt": "2026-03-10T12:00:00.000Z"
        }
      }
    ]
  }
}
```

---

## 存储位置

**默认配置文件路径**: `~/.claude-code-router/pool-config.json`

**备份文件**: `~/.claude-code-router/pool-config.json.backup.<timestamp>`

**备份数量**: 保留最近 3 个备份

---

## 自动保存机制

1. **触发时机**: PoolManager 的以下操作会触发保存标记：
   - `addAccount()` - 添加账号
   - `removeAccount()` - 删除账号
   - `updateAccount()` - 更新账号
   - `setAccountStatus()` - 设置状态
   - `markAccountLimited()` - 标记受限
   - `recoverAccount()` - 恢复账号
   - `updateAccountUsage()` - 更新用量

2. **定时保存**: 每 30 秒检查一次，如果有未保存的更改则执行保存

3. **原子写入**: 使用临时文件 + 重命名方式，防止写入失败导致文件损坏

---

## 验收标准

- [x] 服务启动时自动加载配置文件 ✅
- [x] 配置文件不存在时不报错 ✅
- [x] 配置修改后自动保存 ✅
- [x] 自动创建备份文件 ✅
- [x] 备份文件数量限制 ✅
- [x] 原子写入防止损坏 ✅
- [x] 构建验证通过 ✅

---

## 相关文件

- [Phase 3 计划](./README.md)
- [主计划](../coding-plan-pool-implementation-plan.md)

---

## 下一步

继续 Task 3.2: 绑定持久化，实现 SessionBinding 的持久化存储。

**Task 3.1 完成时间**: 2026-03-10
**状态**: ✅ 已完成
