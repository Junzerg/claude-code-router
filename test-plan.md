# Z.ai 账号池测试计划

**测试目标**: 验证账号池的核心功能（会话绑定、并发控制、错误自动切换）

**测试环境**:
- 账号池服务：已启动（端口 3456）
- 测试账号：2 个智谱账号

---

## 第一步：准备 API Key

### 1.1 获取智谱 API Key

前往 https://open.bigmodel.cn/ 获取你的 API Key

你需要：
- 登录智谱开放平台
- 在个人中心获取 API Key
- 确保账号有足够的额度

### 1.2 记录你的 API Key

准备两个账号的 API Key：
- **账号 1 API Key**: `____________________`
- **账号 2 API Key**: `____________________`

---

## 第二步：添加账号到池

### 2.1 添加第一个账号

```bash
ccr pool add
```

按提示输入：
| 提示项 | 输入值 |
|--------|--------|
| Account name | `账号 1` |
| API Key | (输入你的第一个 API Key) |
| Platform | `zhipu` |
| API Base URL | `https://open.bigmodel.cn/api/anthropic` |
| Max concurrent requests | `3` |
| 5-hour usage limit | `100000` |
| Weekly usage limit | `500000` |
| Buffer ratio | `0.1` |

### 2.2 添加第二个账号

```bash
ccr pool add
```

按提示输入：
| 提示项 | 输入值 |
|--------|--------|
| Account name | `账号 2` |
| API Key | (输入你的第二个 API Key) |
| Platform | `zhipu` |
| API Base URL | `https://open.bigmodel.cn/api/anthropic` |
| Max concurrent requests | `3` |
| 5-hour usage limit | `100000` |
| Weekly usage limit | `500000` |
| Buffer ratio | `0.1` |

### 2.3 验证账号已添加

```bash
ccr pool list
```

**预期输出**:
```
═══════════════════════════════════════════════
        Z.ai Coding Plan Account List
═══════════════════════════════════════════════

┌─────────────────┬──────────────┬───────────┬────────────┬─────────────┐
│ 账号 ID         │ 名称         │ 平台      │ 状态       │ 并发使用    │
├─────────────────┼──────────────┼───────────┼────────────┼─────────────┤
│ cp-xxx-abc      │ 账号 1       │ zhipu     │ active     │ 0/3         │
│ cp-xxx-def      │ 账号 2       │ zhipu     │ active     │ 0/3         │
└─────────────────┴──────────────┴───────────┴────────────┴─────────────┘

账号总数：2 | 活跃：2 | 受限：0
```

---

## 第三步：配置路由

### 3.1 编辑配置文件

打开配置文件：
```bash
# 手动编辑
notepad C:\Users\guchao\.claude-code-router\config.json
```

### 3.2 添加路由配置

确保配置包含：
```json
{
  "APIKEY": "your-router-api-key",
  "PORT": 3456,
  "LOG": true,
  "Providers": [
    {
      "name": "zhipu",
      "api_base_url": "https://open.bigmodel.cn/api/anthropic",
      "api_key": "$ZHIGPU_API_KEY",
      "models": ["glm-coder-plus", "glm-coder-pro"]
    }
  ],
  "Router": {
    "default": "zhipu,glm-coder-plus"
  }
}
```

### 3.3 重启服务

```bash
ccr restart
```

---

## 第四步：功能测试

### 测试 1：基础请求测试

**目的**: 验证账号可以正常响应请求

```bash
ccr code "请用一句话介绍你自己"
```

**预期**: 正常返回响应，无错误

---

### 测试 2：会话绑定测试

**目的**: 验证同一用户的连续请求使用同一个账号

**步骤**:

1. 发起第一个请求：
   ```bash
   ccr code "我是测试用户，请记住我的名字叫做张三"
   ```

2. 查看当前绑定：
   ```bash
   ccr pool binding
   ```
   记录显示的 `session-xxx` 和绑定的账号 ID

3. 发起第二个请求：
   ```bash
   ccr code "我叫什么名字？"
   ```

4. 再次查看绑定，确认使用的是同一账号

**预期**:
- 两次请求使用同一账号
- 第二次回答能正确说出"张三"

---

### 测试 3：并发控制测试

**目的**: 验证并发限制生效

**步骤**:

1. 查看账号详情，确认 maxConcurrency = 3：
   ```bash
   ccr pool status <账号 ID>
   ```

2. 同时发起 4 个请求（打开 4 个终端）：
   ```bash
   # 终端 1
   ccr code "写一篇关于 JavaScript 的短文"

   # 终端 2
   ccr code "解释什么是 TypeScript"

   # 终端 3
   ccr code "React 和 Vue 有什么区别"

   # 终端 4（应该等待）
   ccr code "如何学习编程"
   ```

**预期**: 前 3 个请求并发执行，第 4 个请求等待有空闲槽位

---

### 测试 4：错误自动切换测试

**目的**: 验证账号受限时自动切换到其他可用账号

**步骤**:

1. 查看当前账号列表：
   ```bash
   ccr pool list
   ```
   记录两个账号的 ID

2. 手动将账号 1 标记为受限：
   ```bash
   ccr pool set-status <账号 1 ID> limited
   ```

3. 验证状态已改变：
   ```bash
   ccr pool list
   ```
   账号 1 应显示 `limited` 状态

4. 发起请求：
   ```bash
   ccr code "测试错误切换功能"
   ```

5. 查看日志，确认使用了账号 2

6. 恢复账号 1 状态：
   ```bash
   ccr pool set-status <账号 1 ID> active
   ```

**预期**: 请求成功，系统自动使用账号 2

---

### 测试 5：会话 TTL 过期测试

**目的**: 验证会话绑定 60 分钟后自动过期

**步骤**:

1. 发起请求创建绑定：
   ```bash
   ccr code "创建绑定"
   ```

2. 查看绑定：
   ```bash
   ccr pool binding
   ```

3. 手动清除绑定：
   ```bash
   ccr pool binding --clear
   ```

4. 确认绑定已清除：
   ```bash
   ccr pool binding
   ```

**预期**: 绑定成功清除（实际 TTL 过期需要等待 60 分钟）

---

## 第五步：查看监控

### 5.1 查看账号用量

```bash
ccr pool list
```

查看每个账号的：
- 5 小时用量百分比
- 周用量百分比

### 5.2 查看账号详情

```bash
ccr pool status <账号 ID>
```

查看详细信息包括并发状态、用量历史等

---

## 测试记录表

| 测试编号 | 测试名称 | 结果 | 备注 |
|----------|----------|------|------|
| 测试 1 | 基础请求 | ⬜ 通过 ⬜ 失败 | |
| 测试 2 | 会话绑定 | ⬜ 通过 ⬜ 失败 | |
| 测试 3 | 并发控制 | ⬜ 通过 ⬜ 失败 | |
| 测试 4 | 错误切换 | ⬜ 通过 ⬜ 失败 | |
| 测试 5 | TTL 过期 | ⬜ 通过 ⬜ 失败 | |

---

## 常见问题

### Q: 添加账号时提示 API Key 无效？
A: 确保 API Key 格式正确，没有多余空格

### Q: 请求失败？
A: 检查：
1. 服务是否运行 (`ccr status`)
2. API Key 是否有额度
3. API Base URL 是否正确

### Q: 如何重置测试环境？
A: 删除配置重新开始：
```bash
ccr pool binding --clear
# 删除账号
ccr pool remove <accountId>
```

---

**测试完成后，请填写测试记录表并记录任何发现的问题。**
