# Z.ai Coding Plan 账号池使用说明书

**版本**: v1.0
**更新日期**: 2026-03-10
**适用版本**: claude-code-router v1.5+

---

## 目录

1. [快速开始](#1-快速开始)
2. [账号池管理](#2-账号池管理)
3. [会话绑定管理](#3-会话绑定管理)
4. [监控与告警](#4-监控与告警)
5. [Web UI 使用](#5-web-ui-使用)
6. [测试指南](#6-测试指南)
7. [常见问题](#7-常见问题)
8. [配置文件位置](#8-配置文件位置)
9. [环境变量](#9-环境变量)
10. [命令速查表](#10-命令速查表)

---

## 1. 快速开始

### 1.1 安装

确保已安装 Node.js 20+ 和 pnpm：

```bash
# 安装 claude-code-router
npm install -g @musistudio/claude-code-router

# 验证安装
ccr version
```

### 1.2 启动服务

```bash
# 启动服务
ccr start
```

服务默认运行在 `http://127.0.0.1:3456`

### 1.3 配置账号池

账号池配置存储在 `~/.claude-code-router/pool-config.json`

#### 方式一：使用 CLI 添加账号（推荐）

```bash
# 交互式添加账号
ccr pool add
```

按提示输入：
- Account name: 账号名称/标识
- API Key: Z.ai API Key
- Platform: 平台类型（zai 或 zhipu）
- API Base URL: API 地址（默认即可）
- Max concurrent requests: 最大并发数（默认 3）
- 5-hour usage limit: 5 小时用量上限（默认 100000）
- Weekly usage limit: 周用量上限（默认 500000）
- Buffer ratio: 缓冲比率（默认 0.1）

#### 方式二：命令行添加账号

```bash
ccr pool add \
  --name "账号 1" \
  --api-key "your-api-key" \
  --platform zai \
  --max-concurrency 3 \
  --5h-limit 100000 \
  --weekly-limit 500000 \
  --buffer-ratio 0.1
```

### 1.4 查看账号池状态

```bash
# 查看所有账号
ccr pool list

# 查看账号详情
ccr pool status <accountId>
```

### 1.5 配置路由（可选）

编辑 `~/.claude-code-router/config.json`，配置路由规则：

```json
{
  "Router": {
    "default": "zai,cp-xxx"
  }
}
```

---

## 2. 账号池管理

### 2.1 查看账号列表

```bash
ccr pool list
```

输出示例：
```
═══════════════════════════════════════════════
        Z.ai Coding Plan Account Pool
═══════════════════════════════════════════════

┌─────────────────┬──────────────┬───────────┬────────────┬─────────────┐
│ 账号 ID         │ 名称         │ 平台      │ 状态       │ 并发使用    │
├─────────────────┼──────────────┼───────────┼────────────┼─────────────┤
│ cp-123456-abc   │ 账号 1       │ zai       │ active     │ 0/3         │
│ cp-123457-def   │ 账号 2       │ zhipu     │ active     │ 1/3         │
└─────────────────┴──────────────┴───────────┴────────────┴─────────────┘

账号总数：2 | 活跃：2 | 受限：0
```

### 2.2 查看账号详情

```bash
ccr pool status <accountId>
```

显示信息包括：
- 基础信息（ID、名称、平台）
- 并发状态（当前/最大）
- 用量统计（5 小时、周）
- 配置（并发上限、用量上限、缓冲比率）

### 2.3 移除账号

```bash
ccr pool remove <accountId>
```

### 2.4 设置账号状态

手动设置账号状态（用于测试或临时禁用）：

```bash
# 标记为受限
ccr pool set-status <accountId> limited

# 标记为错误
ccr pool set-status <accountId> error

# 标记为禁用
ccr pool set-status <accountId> disabled

# 恢复为正常
ccr pool set-status <accountId> active
```

### 2.5 账号状态说明

| 状态 | 说明 | 处理方式 |
|------|------|----------|
| `active` | 正常 | 可正常使用 |
| `limited` | 受限（用量耗尽/限流） | 自动切换其他账号 |
| `error` | 错误状态 | 检查 API Key 是否有效 |
| `disabled` | 已禁用 | 手动启用或移除 |

---

## 3. 会话绑定管理

会话绑定确保同一用户的连续请求使用同一个账号，保持上下文连贯性。

### 3.1 查看会话绑定

```bash
# 查看所有绑定
ccr pool binding --list

# JSON 格式输出
ccr pool binding --json
```

输出示例：
```
═══════════════════════════════════════════════
        Z.ai Coding Plan Session Bindings
═══════════════════════════════════════════════

┌──────────────────────────────┬─────────────────┬──────────────┬─────────────┐
│ 会话 ID                      │ 账号 ID         │ 创建时间     │ 最后活跃    │
├──────────────────────────────┼─────────────────┼──────────────┼─────────────┤
│ session-abc123...           │ cp-123456-abc   │ 03/10 14:30  │ 5 分钟前     │
│ session-def456...           │ cp-123457-def   │ 03/10 13:00  │ 2 小时前     │
└──────────────────────────────┴─────────────────┴──────────────┴─────────────┘

绑定统计
────────────────────────────────────────
总绑定数：2
TTL: 60 分钟
受限解除：启用
自动清理：运行中
```

### 3.2 移除会话绑定

```bash
# 移除特定绑定
ccr pool binding --remove --session <sessionId>

# 清除所有绑定
ccr pool binding --clear
```

### 3.3 绑定机制说明

- **TTL 过期**: 绑定默认 60 分钟无活动后自动过期
- **自动释放**: 账号受限时自动解除绑定
- **新建绑定**: 新用户请求自动创建绑定

---

## 4. 监控与告警

### 4.1 查看账号用量

```bash
ccr pool list
```

显示每个账号的：
- 5 小时用量及上限
- 周用量及上限
- 用量百分比

### 4.2 告警类型

系统支持以下告警类型：

| 告警类型 | 触发条件 | 处理方式 |
|----------|----------|----------|
| 账号受限 | 遇到限流错误 | 自动切换账号 + 告警 |
| 用量阈值 | 用量超过 80% | 发送告警通知 |
| 并发告警 | 并发槽位耗尽 | 发送告警通知 |

### 4.3 告警配置

告警服务通过代码初始化，配置示例：

```typescript
// 在服务初始化代码中配置
const alertService = new AlertService(poolManager, {
  fiveHourWarningThreshold: 0.8,      // 5 小时用量告警阈值（80%）
  fiveHourCriticalThreshold: 0.95,    // 5 小时用量严重阈值（95%）
  weeklyWarningThreshold: 0.8,        // 周用量告警阈值（80%）
  weeklyCriticalThreshold: 0.95,      // 周用量严重阈值（95%）
  concurrencyWarningThreshold: 0.8,   // 并发告警阈值（80%）
  maxAlertsInMemory: 100,             // 最多保留告警数
});

// 注册告警处理器（支持 webhook、邮件等）
alertService.onAlert(async (alert) => {
  // Webhook 通知
  await fetch('https://your-webhook.com/alert', {
    method: 'POST',
    body: JSON.stringify(alert),
  });

  // 或发送邮件、写入日志等
});
```

**告警冷却机制**: 同一账号的相同告警 5 分钟内只发送一次，避免重复告警。

---

## 5. Web UI 使用

### 5.1 打开 Web UI

```bash
ccr ui
```

自动在浏览器中打开管理界面。

### 5.2 UI 功能

- **Dashboard**: 查看服务状态和请求统计
- **Providers**: 管理 Provider 配置
- **Transformers**: 配置转换器
- **Presets**: 管理预设配置
- **账号池状态** (`/pool-status`): 查看账号池状态、会话绑定和用量
- **Request History**: 查看请求历史记录
- **Settings**: 系统设置

---

## 6. 测试指南

### 6.1 基础功能测试

#### 测试 1：添加账号

```bash
# 添加测试账号
ccr pool add \
  --name "TestAccount1" \
  --api-key "test-key-1" \
  --platform zai \
  --max-concurrency 2 \
  --5h-limit 10000 \
  --weekly-limit 50000
```

**预期结果**: 账号成功添加，显示账号详情

#### 测试 2：查看账号列表

```bash
ccr pool list
```

**预期结果**: 显示刚添加的账号

#### 测试 3：查看绑定列表

```bash
ccr pool binding
```

**预期结果**: 显示当前活跃绑定（初始可能为空）

#### 测试 4：设置账号状态

```bash
# 标记账号为受限
ccr pool set-status <accountId> limited

# 查看状态是否改变
ccr pool list

# 恢复账号状态
ccr pool set-status <accountId> active
```

**预期结果**: 账号状态成功切换

### 6.2 并发控制测试

**前置条件**：确保账号池服务已启动并配置了至少一个账号。

#### 测试步骤

1. 配置单账号，`maxConcurrency=1`
2. 同时发起 2 个请求
3. 观察第二个请求是否等待

```bash
# 终端 1
ccr code "请写一篇关于 React 的短文"

# 终端 2（同时执行）
ccr code "请解释什么是 TypeScript"
```

**预期结果**: 第二个请求等待第一个完成后执行

### 6.3 会话绑定测试

#### 测试步骤

1. 发起第一个请求，记录使用的账号
2. 用相同会话发起第二个请求
3. 验证使用同一账号

```bash
# 第一次请求
ccr code "我是用户 A，请记住我的名字"

# 查看绑定
ccr pool binding

# 第二次请求
ccr code "刚才我说我叫什么名字？"
```

**预期结果**: 两次请求使用同一账号，能正确回答

### 6.4 错误自动切换测试

**前置条件**：配置至少 2 个账号。

#### 测试步骤

1. 配置 2 个账号
2. 手动将账号 1 标记为受限
3. 发起请求，验证自动切换到账号 2

```bash
# 查看当前状态
ccr pool list

# 手动将账号 1 标记为受限
ccr pool set-status <accountId> limited

# 发起请求（应使用账号 2）
ccr code "测试错误切换功能"

# 恢复账号 1 状态
ccr pool set-status <accountId> active
```

**预期结果**：请求成功，使用可用账号

---

## 7. 常见问题

### Q1: 服务启动失败

**可能原因**:
- 端口被占用
- 配置文件格式错误

**解决方法**:
```bash
# 检查服务状态
ccr status

# 查看详细日志
cat ~/.claude-code-router/logs/ccr-*.log
```

### Q2: 所有账号都显示受限

**可能原因**:
- 所有账号用量耗尽
- API Key 失效

**解决方法**:
```bash
# 清除所有绑定（强制刷新）
ccr pool binding --clear

# 检查账号状态
ccr pool list
```

### Q3: 会话绑定不生效

**可能原因**:
- 请求未携带会话 ID
- TTL 过期

**解决方法**:
- 确保 Claude Code 使用相同会话
- 等待新请求自动创建绑定

### Q4: 如何重置配置

```bash
# 删除配置目录
rm -rf ~/.claude-code-router/pool-config.json

# 重新添加账号
ccr pool add
```

---

## 8. 配置文件位置

| 文件 | 路径 | 说明 |
|------|------|------|
| 主配置 | `~/.claude-code-router/config.json` | 路由、Provider 配置 |
| 账号池配置 | `~/.claude-code-router/pool-config.json` | 账号池配置 |
| 会话绑定 | `~/.claude-code-router/binding-storage.json` | 会话绑定数据 |
| 用量历史 | `~/.claude-code-router/usage-history.json` | 历史用量记录 |
| 日志文件 | `~/.claude-code-router/logs/ccr-*.log` | 服务日志 |
| 应用日志 | `~/.claude-code-router/claude-code-router.log` | 应用级日志 |

---

## 9. 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CCR_PORT` | 3000 | CLI 命令连接服务器 API 的端口（如 pool binding 命令） |
| `SERVICE_PORT` | 3456 | 服务端口 |
| `ANTHROPIC_BASE_URL` | `http://127.0.0.1:3456` | API 地址 |
| `ANTHROPIC_AUTH_TOKEN` | - | API Key |

设置环境变量：
```bash
eval "$(ccr activate)"
```

---

## 10. 命令速查表

| 命令 | 功能 |
|------|------|
| `ccr start` | 启动服务 |
| `ccr stop` | 停止服务 |
| `ccr restart` | 重启服务 |
| `ccr status` | 查看状态 |
| `ccr code <prompt>` | 执行 Claude Code |
| `ccr ui` | 打开 Web UI |
| `ccr model` | 模型选择 |
| `ccr preset list` | 列出预设 |
| `ccr preset export <name>` | 导出预设 |
| `ccr preset install <source>` | 安装预设 |
| `eval "$(ccr activate)"` | 设置环境变量 |
| **账号池命令** | |
| `ccr pool add` | 添加账号 |
| `ccr pool list` | 列出账号 |
| `ccr pool status <id>` | 账号详情 |
| `ccr pool remove <id>` | 移除账号 |
| `ccr pool set-status <id> <status>` | 设置账号状态 |
| `ccr pool binding` | 管理会话绑定 |

---

## 附录：完整配置示例

`~/.claude-code-router/config.json`:

```json
{
  "APIKEY": "your-router-api-key",
  "PORT": 3456,
  "LOG": true,
  "LOG_LEVEL": "info",
  "Providers": [
    {
      "name": "zai",
      "api_base_url": "https://api.z.ai/api/anthropic",
      "api_key": "$ZAI_API_KEY",
      "models": ["glm-coder-plus", "glm-coder-pro"]
    }
  ],
  "Router": {
    "default": "zai,glm-coder-plus"
  }
}
```

`~/.claude-code-router/pool-config.json`:

```json
{
  "defaultMaxConcurrency": 3,
  "defaultBufferRatio": 0.1,
  "accounts": [
    {
      "id": "cp-1710000000000-abc123",
      "name": "账号 1",
      "platform": "zai",
      "apiKey": "your-api-key-1",
      "apiBaseUrl": "https://api.z.ai/api/anthropic",
      "status": "active",
      "concurrency": {
        "current": 0,
        "max": 3,
        "lastUpdated": "2026-03-10T12:00:00.000Z"
      },
      "usage": {
        "last5Hours": 50000,
        "weekly": 200000,
        "last5HoursLimit": 100000,
        "weeklyLimit": 500000,
        "lastSyncedAt": "2026-03-10T12:00:00.000Z"
      },
      "config": {
        "maxConcurrency": 3,
        "last5HoursLimit": 100000,
        "weeklyLimit": 500000,
        "bufferRatio": 0.1
      },
      "metadata": {
        "createdAt": "2026-03-10T12:00:00.000Z",
        "updatedAt": "2026-03-10T12:00:00.000Z"
      }
    }
  ]
}
```

---

**文档结束**

如有问题，请查看项目 README 或提交 Issue。
