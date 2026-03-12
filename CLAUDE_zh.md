# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在此代码仓库中工作提供指导。

## 项目概述

Claude Code Router 是一个将 Claude Code 请求路由到不同 LLM 提供商的工具。它采用 Monorepo 架构，包含五个主要包：

- **core** (`@musistudio/llms`): 核心 LLM API 转换服务器，包含转换器和路由逻辑（独立发布的包）
- **cli** (`@CCR/cli`): 命令行工具，提供 `ccr` 命令
- **server** (`@CCR/server`): 服务器包装器，将核心功能与 CLI 特性集成
- **shared** (`@CCR/shared`): 共享常量、工具函数和预设管理
- **ui** (`@CCR/ui`): Web 管理界面（React + Vite）

## 构建命令

### 构建所有包
```bash
pnpm build
```

### 构建单个包
```bash
pnpm build:core     # 构建 core (@musistudio/llms)
pnpm build:shared   # 构建 shared 工具库
pnpm build:server   # 构建 server
pnpm build:cli      # 构建 CLI
pnpm build:ui       # 构建 UI (Vite)
pnpm build:docs     # 构建文档
```

### 开发模式
```bash
pnpm dev:core       # 开发 core (tsx watch)
pnpm dev:server     # 开发 server (ts-node)
pnpm dev:cli        # 开发 CLI (ts-node)
pnpm dev:ui         # 开发 UI (Vite HMR)
pnpm dev:docs       # 开发文档
```

### 代码检查
```bash
pnpm --filter @CCR/ui lint    # 运行 UI 包的 ESLint
```

### 发布
```bash
pnpm release        # 构建并发布所有包
pnpm release:npm    # 仅发布到 npm
pnpm release:docker # 仅构建并推送 Docker 镜像
```

## 核心架构

### 1. 路由系统 (packages/core/src/utils/router.ts)

路由逻辑决定请求应发送到哪个模型：

- **默认路由**: 使用 `Router.default` 配置
- **项目级路由**: 检查 `~/.claude/projects/<project-id>/claude-code-router.json`
- **自定义路由**: 通过 `CUSTOM_ROUTER_PATH` 加载自定义 JavaScript 路由函数
- **内置场景路由**:
  - `background`: 后台任务（通常使用轻量级模型）
  - `think`: 思考密集型任务（Plan Mode）
  - `longContext`: 长上下文（超过 `longContextThreshold` tokens）
  - `webSearch`: 网络搜索任务
  - `image`: 图像相关任务

Token 计算使用 `tiktoken` (cl100k_base) 来估算请求大小。

### 2. Core 包 (`@musistudio/llms`)

core 包是系统的心脏，提供：

**服务** (`packages/core/src/services/`):
- `config.ts`: 配置管理，支持 JSON5
- `provider.ts`: 提供商注册表和模型发现
- `tokenizer.ts`: Token 计数抽象（支持 tiktoken 和 HuggingFace tokenizers）
- `transformer.ts`: 转换器注册表和应用逻辑

**转换器** (`packages/core/src/transformer/`):
- 每个提供商的内置转换器：`anthropic`, `deepseek`, `gemini`, `openrouter`, `groq` 等
- 功能性转换器：`maxtoken`, `tooluse`, `reasoning`, `enhancetool`, `sampling` 等
- 每个转换器实现请求/响应转换接口

**SSE 处理** (`packages/core/src/utils/sse/`):
- `SSEParserTransform`: 将 SSE 文本流解析为事件对象
- `SSESerializerTransform`: 将事件对象序列化为 SSE 文本流
- `rewriteStream`: 拦截和修改流数据（用于 agent 工具调用）

### 3. 转换器系统（应用层）

server 层使用 core 中的转换器来处理请求/响应转换：

- **全局应用**: 将转换器应用于提供商的所有模型
- **模型特定应用**: 仅将转换器应用于特定模型
- **选项传递**: 向转换器传递配置（例如 `maxtoken` 的 `max_tokens` 参数）
- **自定义转换器**: 通过 `config.json` 中的 `transformers` 数组加载外部插件

### 4. Agent 系统 (packages/server/src/agents/)

Agent 是可插拔的功能模块，可以：
- 检测是否处理请求 (`shouldHandle`)
- 修改请求 (`reqHandler`)
- 提供自定义工具 (`tools`)

内置 agent:
- **imageAgent**: 处理图像相关任务

Agent 工具调用流程:
1. 在 `preHandler` 钩子中检测并标记 agent
2. 将 agent 工具添加到请求中
3. 在 `onSend` 钩子中拦截工具调用事件
4. 执行 agent 工具并发起新的 LLM 请求
5. 将结果流式返回

### 5. SSE 流处理

server 使用自定义 Transform 流来处理 Server-Sent Events:
- `SSEParserTransform`: 将 SSE 文本流解析为事件对象
- `SSESerializerTransform`: 将事件对象序列化为 SSE 文本流
- `rewriteStream`: 拦截和修改流数据（用于 agent 工具调用）

### 6. 配置管理

配置文件位置：`~/.claude-code-router/config.json`

主要特性:
- 支持环境变量插值（`$VAR_NAME` 或 `${VAR_NAME}`）
- JSON5 格式（支持注释）
- 自动备份（保留最近 3 个备份）
- 热重载需要服务重启 (`ccr restart`)

配置验证:
- 如果配置了 `Providers`，必须设置 `HOST` 和 `APIKEY`
- 否则监听 `0.0.0.0` 但不进行身份验证

### 7. 日志系统

两个独立的日志系统:

**Server 级日志** (pino):
- 位置：`~/.claude-code-router/logs/ccr-*.log`
- 内容：HTTP 请求、API 调用、服务器事件
- 配置：`LOG_LEVEL` (fatal/error/warn/info/debug/trace)

**应用级日志**:
- 位置：`~/.claude-code-router/claude-code-router.log`
- 内容：路由决策、业务逻辑事件

## CLI 命令

```bash
ccr start      # 启动服务器
ccr stop       # 停止服务器
ccr restart    # 重启服务器
ccr status     # 显示状态
ccr code       # 执行 claude 命令
ccr model      # 交互式模型选择和配置
ccr preset     # 管理预设（export, install, list, info, delete）
ccr activate   # 输出 shell 环境变量（用于集成）
ccr ui         # 打开 Web UI
ccr statusline # 集成状态栏（从 stdin 读取 JSON）
```

### 预设命令

```bash
ccr preset export <name>      # 将当前配置导出为预设
ccr preset install <source>   # 从文件、URL 或名称安装预设
ccr preset list               # 列出所有已安装的预设
ccr preset info <name>        # 显示预设信息
ccr preset delete <name>      # 删除预设
```

## Subagent 路由

在 subagent prompt 中使用特殊标签来指定模型：
```
<CCR-SUBAGENT-MODEL>provider,model</CCR-SUBAGENT-MODEL>
请帮我分析这段代码...
```

## 预设系统

预设系统允许用户轻松保存、分享和重用配置。

### 预设结构

预设存储在 `~/.claude-code-router/presets/<preset-name>/manifest.json`

每个预设包含:
- **元数据**: name, version, description, author, keywords 等
- **配置**: Providers, Router, transformers 和其他设置
- **动态 Schema** (可选): 用于在安装期间收集所需信息的输入字段
- **必需输入** (可选): 安装期间需要填写的字段（例如 API 密钥）

### 核心函数

位于 `packages/shared/src/preset/`:

- **export.ts**: 将当前配置导出为预设目录
  - `exportPreset(presetName, config, options)`: 创建带有 manifest.json 的预设目录
  - 自动清理敏感数据（api_key 字段变为 `{{field}}` 占位符）

- **install.ts**: 安装和管理预设
  - `installPreset(preset, config, options)`: 将预设安装到配置中
  - `loadPreset(source)`: 从目录加载预设
  - `listPresets()`: 列出所有已安装的预设
  - `isPresetInstalled(presetName)`: 检查预设是否已安装
  - `validatePreset(preset)`: 验证预设结构

- **merge.ts**: 将预设配置与现有配置合并
  - 使用不同策略处理冲突（ask, overwrite, merge, skip）

- **sensitiveFields.ts**: 识别和清理敏感字段
  - 自动检测 api_key, password, secret 字段
  - 用环境变量占位符替换敏感值

### 预设文件格式

**manifest.json** (在预设目录中):
```json
{
  "name": "my-preset",
  "version": "1.0.0",
  "description": "我的配置",
  "author": "作者名称",
  "keywords": ["openai", "production"],
  "Providers": [...],
  "Router": {...},
  "schema": [
    {
      "id": "apiKey",
      "type": "password",
      "label": "OpenAI API Key",
      "prompt": "输入你的 OpenAI API 密钥"
    }
  ]
}
```

### CLI 集成

CLI 层 (`packages/cli/src/utils/preset/`) 处理:
- 用户交互和提示
- 文件操作
- 显示格式化

关键文件:
- `commands.ts`: `ccr preset` 子命令的命令处理程序
- `export.ts`: 导出功能的 CLI 包装器
- `install.ts`: 安装功能的 CLI 包装器

## 依赖关系

```
cli → server → core (@musistudio/llms) → shared
server → shared
ui (独立，消费 server API)
docs (独立文档站点)
```

`@musistudio/llms` 包也独立发布到 npm，作为核心转换引擎。

## 开发注意事项

1. **Node.js 版本**: 需要 >= 20.0.0（在 `engines` 字段中强制）
2. **包管理器**: 使用 pnpm（monorepo 依赖 workspace 协议）
3. **TypeScript**: 所有包都使用 TypeScript
   - CLI/Server/Shared: 使用 esbuild 构建的 CommonJS 模块
   - Core (`@musistudio/llms`): 双 ESM/CommonJS 构建
   - UI: 使用 Vite 构建的 ESM 模块
4. **构建工具**:
   - core: 自定义 esbuild 脚本（双 ESM/CJS 输出）
   - cli/server/shared: esbuild
   - ui: Vite + TypeScript
   - docs: Docusaurus（基于 React 的静态站点生成器）
5. **代码注释**: 代码中的所有注释必须用英文书写
6. **文档**: 实现新功能时，将文档添加到 docs 项目，而不是创建独立的 md 文件
7. **类型定义**: Core 包在 `dist/index.d.ts` 中导出类型定义；server 层类型定义在 `packages/server/src/types.d.ts`
8. **测试**: 目前没有正式的测试套件；开发依赖手动测试和端到端使用

## 配置示例位置

- 主要配置示例：README.md 中的完整示例
- 自定义路由器示例：`custom-router.example.js`
