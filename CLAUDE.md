# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Code Router is a tool that routes Claude Code requests to different LLM providers. It uses a Monorepo architecture with five main packages:

- **core** (`@musistudio/llms`): Core LLM API transformation server with transformers and routing logic (external published package)
- **cli** (`@CCR/cli`): Command-line tool providing the `ccr` command
- **server** (`@CCR/server`): Server wrapper that integrates core with CLI-specific features
- **shared** (`@CCR/shared`): Shared constants, utilities, and preset management
- **ui** (`@CCR/ui`): Web management interface (React + Vite)

## Build Commands

### Build all packages
```bash
pnpm build
```

### Build individual packages
```bash
pnpm build:core     # Build core (@musistudio/llms)
pnpm build:shared   # Build shared utilities
pnpm build:server   # Build server
pnpm build:cli      # Build CLI
pnpm build:ui       # Build UI (Vite)
pnpm build:docs     # Build documentation
```

### Development mode
```bash
pnpm dev:core       # Develop core (tsx watch)
pnpm dev:server     # Develop server (ts-node)
pnpm dev:cli        # Develop CLI (ts-node)
pnpm dev:ui         # Develop UI (Vite HMR)
pnpm dev:docs       # Develop documentation
```

### Linting
```bash
pnpm --filter @CCR/ui lint    # Run ESLint on UI package
```

### Publish
```bash
pnpm release        # Build and publish all packages
pnpm release:npm    # Publish to npm only
pnpm release:docker # Build and push Docker image only
```

## Core Architecture

### 1. Routing System (packages/core/src/utils/router.ts)

The routing logic determines which model a request should be sent to:

- **Default routing**: Uses `Router.default` configuration
- **Project-level routing**: Checks `~/.claude/projects/<project-id>/claude-code-router.json`
- **Custom routing**: Loads custom JavaScript router function via `CUSTOM_ROUTER_PATH`
- **Built-in scenario routing**:
  - `background`: Background tasks (typically lightweight models)
  - `think`: Thinking-intensive tasks (Plan Mode)
  - `longContext`: Long context (exceeds `longContextThreshold` tokens)
  - `webSearch`: Web search tasks
  - `image`: Image-related tasks

Token calculation uses `tiktoken` (cl100k_base) to estimate request size.

### 2. Core Package (`@musistudio/llms`)

The core package is the heart of the system, providing:

**Services** (`packages/core/src/services/`):
- `config.ts`: Configuration management with JSON5 support
- `provider.ts`: Provider registry and model discovery
- `tokenizer.ts`: Token counting abstraction (supports tiktoken and HuggingFace tokenizers)
- `transformer.ts`: Transformer registry and application logic

**Transformers** (`packages/core/src/transformer/`):
- Built-in transformers for each provider: `anthropic`, `deepseek`, `gemini`, `openrouter`, `groq`, etc.
- Functional transformers: `maxtoken`, `tooluse`, `reasoning`, `enhancetool`, `sampling`, etc.
- Each transformer implements request/response transformation interfaces

**SSE Processing** (`packages/core/src/utils/sse/`):
- `SSEParserTransform`: Parses SSE text stream into event objects
- `SSESerializerTransform`: Serializes event objects into SSE text stream
- `rewriteStream`: Intercepts and modifies stream data (for agent tool calls)

### 3. Transformer System (Application Level)

The server layer uses transformers from core to handle request/response transformations:

- **Global application**: Apply transformer to all models from a provider
- **Model-specific application**: Apply transformer only to specific models
- **Option passing**: Pass configuration to transformers (e.g., `max_tokens` for `maxtoken`)
- **Custom transformers**: Load external plugins via `transformers` array in `config.json`

### 4. Agent System (packages/server/src/agents/)

Agents are pluggable feature modules that can:
- Detect whether to handle a request (`shouldHandle`)
- Modify requests (`reqHandler`)
- Provide custom tools (`tools`)

Built-in agents:
- **imageAgent**: Handles image-related tasks

Agent tool call flow:
1. Detect and mark agents in `preHandler` hook
2. Add agent tools to the request
3. Intercept tool call events in `onSend` hook
4. Execute agent tool and initiate new LLM request
5. Stream results back

### 5. SSE Stream Processing

The server uses custom Transform streams to handle Server-Sent Events:
- `SSEParserTransform`: Parses SSE text stream into event objects
- `SSESerializerTransform`: Serializes event objects into SSE text stream
- `rewriteStream`: Intercepts and modifies stream data (for agent tool calls)

### 6. Configuration Management

Configuration file location: `~/.claude-code-router/config.json`

Key features:
- Supports environment variable interpolation (`$VAR_NAME` or `${VAR_NAME}`)
- JSON5 format (supports comments)
- Automatic backups (keeps last 3 backups)
- Hot reload requires service restart (`ccr restart`)

Configuration validation:
- If `Providers` are configured, both `HOST` and `APIKEY` must be set
- Otherwise listens on `0.0.0.0` without authentication

### 7. Logging System

Two separate logging systems:

**Server-level logs** (pino):
- Location: `~/.claude-code-router/logs/ccr-*.log`
- Content: HTTP requests, API calls, server events
- Configuration: `LOG_LEVEL` (fatal/error/warn/info/debug/trace)

**Application-level logs**:
- Location: `~/.claude-code-router/claude-code-router.log`
- Content: Routing decisions, business logic events

## CLI Commands

```bash
ccr start      # Start server
ccr stop       # Stop server
ccr restart    # Restart server
ccr status     # Show status
ccr code       # Execute claude command
ccr model      # Interactive model selection and configuration
ccr preset     # Manage presets (export, install, list, info, delete)
ccr activate   # Output shell environment variables (for integration)
ccr ui         # Open Web UI
ccr statusline # Integrated statusline (reads JSON from stdin)
```

### Preset Commands

```bash
ccr preset export <name>      # Export current configuration as a preset
ccr preset install <source>   # Install a preset from file, URL, or name
ccr preset list               # List all installed presets
ccr preset info <name>        # Show preset information
ccr preset delete <name>      # Delete a preset
```

## Subagent Routing

Use special tags in subagent prompts to specify models:
```
<CCR-SUBAGENT-MODEL>provider,model</CCR-SUBAGENT-MODEL>
Please help me analyze this code...
```

## Preset System

The preset system allows users to save, share, and reuse configurations easily.

### Preset Structure

Presets are stored in `~/.claude-code-router/presets/<preset-name>/manifest.json`

Each preset contains:
- **Metadata**: name, version, description, author, keywords, etc.
- **Configuration**: Providers, Router, transformers, and other settings
- **Dynamic Schema** (optional): Input fields for collecting required information during installation
- **Required Inputs** (optional): Fields that need to be filled during installation (e.g., API keys)

### Core Functions

Located in `packages/shared/src/preset/`:

- **export.ts**: Export current configuration as a preset directory
  - `exportPreset(presetName, config, options)`: Creates preset directory with manifest.json
  - Automatically sanitizes sensitive data (api_key fields become `{{field}}` placeholders)

- **install.ts**: Install and manage presets
  - `installPreset(preset, config, options)`: Install preset to config
  - `loadPreset(source)`: Load preset from directory
  - `listPresets()`: List all installed presets
  - `isPresetInstalled(presetName)`: Check if preset is installed
  - `validatePreset(preset)`: Validate preset structure

- **merge.ts**: Merge preset configuration with existing config
  - Handles conflicts using different strategies (ask, overwrite, merge, skip)

- **sensitiveFields.ts**: Identify and sanitize sensitive fields
  - Detects api_key, password, secret fields automatically
  - Replaces sensitive values with environment variable placeholders

### Preset File Format

**manifest.json** (in preset directory):
```json
{
  "name": "my-preset",
  "version": "1.0.0",
  "description": "My configuration",
  "author": "Author Name",
  "keywords": ["openai", "production"],
  "Providers": [...],
  "Router": {...},
  "schema": [
    {
      "id": "apiKey",
      "type": "password",
      "label": "OpenAI API Key",
      "prompt": "Enter your OpenAI API key"
    }
  ]
}
```

### CLI Integration

The CLI layer (`packages/cli/src/utils/preset/`) handles:
- User interaction and prompts
- File operations
- Display formatting

Key files:
- `commands.ts`: Command handlers for `ccr preset` subcommands
- `export.ts`: CLI wrapper for export functionality
- `install.ts`: CLI wrapper for install functionality

## Dependencies

```
cli → server → core (@musistudio/llms) → shared
server → shared
ui (standalone, consumes server API)
docs (standalone documentation site)
```

The `@musistudio/llms` package is also published independently to npm and serves as the core transformation engine.

## Development Notes

1. **Node.js version**: Requires >= 20.0.0 ( enforced in `engines` field)
2. **Package manager**: Uses pnpm (monorepo depends on workspace protocol)
3. **TypeScript**: All packages use TypeScript
   - CLI/Server/Shared: CommonJS modules built with esbuild
   - Core (`@musistudio/llms`): Dual ESM/CommonJS build
   - UI: ESM module built with Vite
4. **Build tools**:
   - core: Custom esbuild script (dual ESM/CJS output)
   - cli/server/shared: esbuild
   - ui: Vite + TypeScript
   - docs: Docusaurus (React-based static site generator)
5. **Code comments**: All comments in code MUST be written in English
6. **Documentation**: When implementing new features, add documentation to the docs project instead of creating standalone md files
7. **Type definitions**: Core package exports type definitions in `dist/index.d.ts`; server layer type definitions in `packages/server/src/types.d.ts`
8. **Testing**: Currently no formal test suite; development relies on manual testing and end-to-end usage

## Configuration Example Locations

- Main configuration example: Complete example in README.md
- Custom router example: `custom-router.example.js`
