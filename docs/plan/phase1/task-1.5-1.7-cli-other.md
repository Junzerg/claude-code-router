# Task 1.5-1.7: CLI 命令 - remove/list/status

**优先级**: P0
**预计时间**: 3 小时 (合计)
**依赖**: Task 1.4 (pool add)

---

## Task 1.5: ccr pool remove

### 文件位置
`packages/cli/src/commands/pool-remove.ts`

### 命令格式
```bash
ccr pool remove [options] <accountId>
```

### 选项
| 选项 | 简写 | 说明 |
|------|------|------|
| `--force` | `-f` | 强制删除 (即使有活跃会话) |
| `--yes` | `-y` | 跳过确认提示 |

### 使用示例
```bash
# 删除账号 (带确认)
ccr pool remove cp-1234567890

# 强制删除
ccr pool remove cp-1234567890 --force

# 跳过确认
ccr pool remove cp-1234567890 --yes
```

### 核心实现
```typescript
const poolRemoveCommand = new Command('remove')
  .description('删除 Z.ai Coding Plan 账号')
  .argument('<accountId>', '账号 ID')
  .option('-f, --force', '强制删除 (即使有活跃会话)')
  .option('-y, --yes', '跳过确认提示')
  .action(async (accountId, options) => {
    const poolManager = PoolManager.getInstance();
    const account = poolManager.getAccount(accountId);

    if (!account) {
      console.error(`账号 ${accountId} 不存在`);
      return;
    }

    // 检查是否有活跃会话
    if (account.concurrency.current > 0 && !options.force) {
      console.error(`账号 ${accountId} 有 ${account.concurrency.current} 个活跃会话`);
      console.error('使用 --force 强制删除');
      return;
    }

    // 确认删除
    if (!options.yes) {
      const confirmed = await confirm({
        message: `确定要删除账号 "${account.name}" 吗？`,
      });
      if (!confirmed) return;
    }

    poolManager.removeAccount(accountId);
    console.log(`账号已删除：${account.name}`);
  });
```

---

## Task 1.6: ccr pool list

### 文件位置
`packages/cli/src/commands/pool-list.ts`

### 命令格式
```bash
ccr pool list [options]
```

### 选项
| 选项 | 简写 | 说明 | 默认值 |
|------|------|------|--------|
| `--status` | `-s` | 按状态过滤 (active/limited/error) | 全部 |
| `--verbose` | `-v` | 显示详细信息 | false |
| `--json` | | 以 JSON 格式输出 | false |

### 使用示例
```bash
# 列出所有账号
ccr pool list

# 只显示活跃账号
ccr pool list --status active

# 详细信息
ccr pool list --verbose

# JSON 输出
ccr pool list --json
```

### 输出示例
```
┌─────────────────┬────────────┬─────────┬──────────┬───────────────┐
│ ID              │ 名称       │ 平台    │ 状态     │ 并发 (使用/最大)│
├─────────────────┼────────────┼─────────┼──────────┼───────────────┤
│ cp-1710000001   │ 主账号 1    │ zai     │ active   │ 1/3           │
│ cp-1710000002   │ 主账号 2    │ zhipu   │ active   │ 0/3           │
│ cp-1710000003   │ 备用账号    │ zai     │ limited  │ 0/3           │
└─────────────────┴────────────┴─────────┴──────────┴───────────────┘
```

### 核心实现
```typescript
const poolListCommand = new Command('list')
  .description('列出所有 Z.ai Coding Plan 账号')
  .option('-s, --status <string>', '按状态过滤')
  .option('-v, --verbose', '显示详细信息')
  .option('--json', '以 JSON 格式输出')
  .action(async (options) => {
    const poolManager = PoolManager.getInstance();
    let accounts = poolManager.getAllAccounts();

    // 状态过滤
    if (options.status) {
      accounts = accounts.filter(a => a.status === options.status);
    }

    // JSON 输出
    if (options.json) {
      console.log(JSON.stringify(accounts, null, 2));
      return;
    }

    // 表格输出
    console.log('\n账号列表:\n');
    console.table(accounts.map(a => ({
      ID: a.id,
      名称：a.name,
      平台：a.platform,
      状态：a.status,
      并发：`${a.concurrency.current}/${a.concurrency.max}`,
      '5h 用量': `${Math.round(a.usage.last5Hours / a.config.last5HoursLimit * 100)}%`,
    })));
  });
```

---

## Task 1.7: ccr pool status

### 文件位置
`packages/cli/src/commands/pool-status.ts`

### 命令格式
```bash
ccr pool status [options] [accountId]
```

### 选项
| 选项 | 简写 | 说明 |
|------|------|------|
| `--json` | | 以 JSON 格式输出 |

### 使用示例
```bash
# 查看账号池整体状态
ccr pool status

# 查看指定账号详情
ccr pool status cp-1710000001
```

### 输出示例
```
账号池状态
─────────────────────────────────────
总账号数：3
活跃账号：2
受限账号：1
错误账号：0

并发统计:
  总槽位数：9
  已用槽位：1
  可用槽位：8

账号详情 (cp-1710000001):
  名称：主账号 1
  平台：zai
  状态：active
  并发：1/3
  5h 用量：45/100 (45%)
  周用量：120/1000 (12%)
  最后更新：2026-03-09 10:30:00
  会话绑定:
    - session_abc123 (活跃)
    - session_def456 (活跃)
```

### 核心实现
```typescript
const poolStatusCommand = new Command('status')
  .description('显示账号池状态')
  .argument('[accountId]', '账号 ID (可选)')
  .option('--json', '以 JSON 格式输出')
  .action(async (accountId, options) => {
    const poolManager = PoolManager.getInstance();

    if (accountId) {
      // 显示指定账号详情
      const account = poolManager.getAccount(accountId);
      if (!account) {
        console.error(`账号 ${accountId} 不存在`);
        return;
      }
      displayAccountDetail(account);
    } else {
      // 显示账号池整体状态
      displayPoolStatus(poolManager);
    }
  });

function displayPoolStatus(poolManager: PoolManager) {
  const accounts = poolManager.getAllAccounts();
  const status = poolManager.getPoolStatus();

  console.log('\n账号池状态');
  console.log('─'.repeat(40));
  console.log(`总账号数：${status.total}`);
  console.log(`活跃账号：${status.active}`);
  console.log(`受限账号：${status.limited}`);
  console.log(`错误账号：${status.error}`);
  console.log('\n并发统计:');
  console.log(`  总槽位数：${status.totalConcurrency}`);
  console.log(`  已用槽位：${status.totalConcurrency - status.availableConcurrency}`);
  console.log(`  可用槽位：${status.availableConcurrency}`);
}
```

---

## 验收标准

### pool remove
- [x] 删除不存在的账号时报错
- [x] 有活跃会话时提示确认
- [x] 强制删除可以跳过会话检查

**完成时间**: 2026-03-10
**状态**: ✅ 已完成

### pool list
- [x] 正确显示所有账号
- [x] 状态过滤工作正常
- [x] JSON 输出格式正确

**完成时间**: 2026-03-10
**状态**: ✅ 已完成

### pool status
- [x] 显示账号池整体状态
- [x] 显示指定账号详情
- [x] 用量百分比计算正确

**完成时间**: 2026-03-10
**状态**: ✅ 已完成

---

## 相关文件

- [Task 1.4 pool add](./task-1.4-cli-add.md)
- [Phase 1 计划](./README.md)
- [主计划](../coding-plan-pool-implementation-plan.md)
