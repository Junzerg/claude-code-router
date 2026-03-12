# Task 1.4: CLI 命令 - ccr pool add

**优先级**: P0
**预计时间**: 2 小时
**依赖**: Task 1.2 (PoolManager)

---

## 目标

实现 `ccr pool add` 命令，支持动态添加 Z.ai Coding Plan 账号。

---

## 开发内容

### 文件位置
`packages/cli/src/commands/pool-add.ts`

### 命令格式

```bash
ccr pool add [options]
```

### 选项

| 选项 | 简写 | 说明 | 默认值 |
|------|------|------|--------|
| `--id` | `-i` | 账号 ID (可选，自动生成) | 自动生成 |
| `--name` | `-n` | 账号名称/备注 | 必填 |
| `--api-key` | `-k` | API Key | 必填 |
| `--platform` | `-p` | 平台类型 (zai/zhipu) | zai |
| `--api-base-url` | `-u` | API 基础 URL | 根据 platform 自动设置 |
| `--max-concurrency` | `-c` | 最大并发数 | 3 |
| `--5h-limit` | | 5 小时用量限制 | 100 |
| `--weekly-limit` | | 周用量限制 | 1000 |
| `--buffer-ratio` | `-b` | 缓冲比例 (0-1) | 0.1 |

### 使用示例

```bash
# 交互式添加 (推荐)
ccr pool add

# 命令行添加
ccr pool add --name "主账号 1" --api-key "sk-xxx" --platform zai

# 完整选项
ccr pool add \
  --name "主账号 1" \
  --api-key "sk-xxx" \
  --platform zai \
  --api-base-url "https://api.z.ai/api/anthropic" \
  --max-concurrency 3 \
  --5h-limit 100 \
  --weekly-limit 1000 \
  --buffer-ratio 0.1
```

### 核心实现

```typescript
import { Command } from 'commander';
import { PoolManager } from '@CCR/core';
import { input, confirm } from '@inquirer/prompts';

const poolAddCommand = new Command('add')
  .description('添加 Z.ai Coding Plan 账号')
  .option('-n, --name <string>', '账号名称/备注')
  .option('-k, --api-key <string>', 'API Key')
  .option('-p, --platform <string>', '平台类型 (zai/zhipu)', 'zai')
  .option('-u, --api-base-url <string>', 'API 基础 URL')
  .option('-c, --max-concurrency <number>', '最大并发数', '3')
  .option('--5h-limit <number>', '5 小时用量限制', '100')
  .option('--weekly-limit <number>', '周用量限制', '1000')
  .option('-b, --buffer-ratio <number>', '缓冲比例', '0.1')
  .action(async (options) => {
    // 如果未提供必要参数，进入交互模式
    if (!options.name || !options.apiKey) {
      await interactiveMode(options);
    } else {
      await commandMode(options);
    }
  });

async function interactiveMode(options: any) {
  console.log('添加 Z.ai Coding Plan 账号\n');

  const name = options.name || await input({
    message: '账号名称/备注:',
    default: '账号 1',
  });

  const apiKey = options.apiKey || await input({
    message: 'API Key:',
  });

  const platform = options.platform || await input({
    message: '平台类型:',
    default: 'zai',
  });

  // 根据平台设置默认 API URL
  const defaultApiUrl = platform === 'zai'
    ? 'https://api.z.ai/api/anthropic'
    : 'https://open.bigmodel.cn/api/anthropic';

  const apiBaseUrl = options.apiBaseUrl || await input({
    message: 'API 基础 URL:',
    default: defaultApiUrl,
  });

  // 添加账号...
}

async function commandMode(options: any) {
  const poolManager = await PoolManager.getInstance();

  const account = poolManager.addAccount({
    name: options.name,
    apiKey: options.apiKey,
    platform: options.platform,
    apiBaseUrl: options.apiBaseUrl,
    config: {
      maxConcurrency: parseInt(options.maxConcurrency),
      last5HoursLimit: parseInt(options['5hLimit']),
      weeklyLimit: parseInt(options.weeklyLimit),
      bufferRatio: parseFloat(options.bufferRatio),
    },
  });

  console.log(`账号添加成功:`);
  console.log(`  ID: ${account.id}`);
  console.log(`  名称：${account.name}`);
  console.log(`  平台：${account.platform}`);
}
```

---

## 验收标准

- [x] 交互式添加账号成功
- [x] 命令行添加账号成功
- [x] 必填参数校验正确
- [x] API URL 根据平台自动设置
- [x] 添加成功后显示账号信息

**完成时间**: 2026-03-10
**状态**: ✅ 已完成

---

## 实现说明

实际实现包含的功能：

### 命令选项
| 选项 | 简写 | 说明 | 默认值 |
|------|------|------|--------|
| `--name` | `-n` | 账号名称/备注 | 必填（交互模式可输入） |
| `--api-key` | `-k` | API Key | 必填（交互模式可输入） |
| `--platform` | `-p` | 平台类型 (zai/zhipu) | zai |
| `--api-base-url` | `-u` | API 基础 URL | 根据 platform 自动设置 |
| `--max-concurrency` | `-c` | 最大并发数 | 3 |
| `--5h-limit` | | 5 小时用量限制 | 100000 |
| `--weekly-limit` | | 周用量限制 | 500000 |
| `--buffer-ratio` | `-b` | 缓冲比例 (0-1) | 0.1 |

### 功能特性
1. **交互模式**: 未提供必要参数时自动进入交互式问答
2. **命令模式**: 提供完整参数时直接添加
3. **参数校验**: 平台类型、数值范围、URL 格式等
4. **配置持久化**: 自动保存到 `~/.claude-code-router/pool-config.json`
5. **内置 PoolManager**: 自包含轻量级账号管理

### 平台默认 API URL
- `zai`: `https://api.z.ai/api/anthropic`
- `zhipu`/`bigmodel`: `https://open.bigmodel.cn/api/anthropic`

---

## 相关文件

- [Task 1.2 PoolManager](./task-1.2-pool-manager.md)
- [Phase 1 计划](./README.md)
- [主计划](../coding-plan-pool-implementation-plan.md)
