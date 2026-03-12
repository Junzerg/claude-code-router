# Task 2.1-2.2: 会话绑定管理

**优先级**: P0
**预计时间**: 3 小时 (合计)
**依赖**: Phase 1 完成

---

## Task 2.1: 会话绑定管理器

### 文件位置
`packages/core/src/services/session-binder.ts`

### 核心功能

```typescript
import { SessionBinding } from '../types/pool';

/**
 * 会话绑定管理器
 *
 * 功能:
 * - 会话与账号的绑定管理
 * - TTL 过期清理
 * - 绑定打破策略
 */
export class SessionBinder {
  private bindings: Map<string, SessionBinding>;
  private ttlMs: number;
  private breakOnLimited: boolean;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(options: {
    ttlMinutes: number;
    breakOnLimited: boolean;
  });

  /**
   * 获取会话绑定的账号
   */
  getBoundAccount(sessionId: string): string | undefined;

  /**
   * 创建绑定
   */
  bind(sessionId: string, accountId: string): SessionBinding;

  /**
   * 解除绑定
   */
  unbind(sessionId: string): boolean;

  /**
   * 更新活跃时间
   */
  touch(sessionId: string): void;

  /**
   * 检查绑定是否有效
   */
  isValid(sessionId: string): boolean;

  /**
   * 当账号受限时处理绑定
   */
  handleAccountLimited(accountId: string): void;

  /**
   * 获取所有绑定
   */
  getAllBindings(): SessionBinding[];

  /**
   * 启动 TTL 清理
   */
  startCleanup(intervalMs?: number): void;

  /**
   * 停止清理
   */
  stopCleanup(): void;
}
```

### 关键实现细节

#### 1. 绑定创建
```typescript
bind(sessionId: string, accountId: string): SessionBinding {
  // 如果已存在绑定，更新它
  if (this.bindings.has(sessionId)) {
    const binding = this.bindings.get(sessionId)!;
    binding.accountId = accountId;
    binding.lastActiveAt = new Date();
    return binding;
  }

  // 创建新绑定
  const binding: SessionBinding = {
    sessionId,
    accountId,
    createdAt: new Date(),
    lastActiveAt: new Date(),
  };

  this.bindings.set(sessionId, binding);
  return binding;
}
```

#### 2. TTL 检查
```typescript
isValid(sessionId: string): boolean {
  const binding = this.bindings.get(sessionId);
  if (!binding) return false;

  const now = Date.now();
  const lastActiveTime = binding.lastActiveAt.getTime();
  const elapsed = now - lastActiveTime;

  return elapsed < this.ttlMs;
}
```

#### 3. 账号受限处理
```typescript
handleAccountLimited(accountId: string): void {
  if (!this.breakOnLimited) return;

  const toRemove: string[] = [];
  for (const [sessionId, binding] of this.bindings.entries()) {
    if (binding.accountId === accountId) {
      toRemove.push(sessionId);
    }
  }

  for (const sessionId of toRemove) {
    this.bindings.delete(sessionId);
    logger.info(`Broken binding for limited account: ${sessionId}`);
  }
}
```

---

## Task 2.2: 会话 ID 识别工具

### 文件位置
`packages/core/src/utils/session-id.ts`

### 功能说明

从请求中提取唯一的会话标识符。

### 实现

```typescript
import { Message, RequestData } from '../types';

/**
 * 从请求中提取会话 ID
 *
 * 优先级:
 * 1. conversation_id (Anthropic/Claude Code)
 * 2. custom_session_id (自定义)
 * 3. 基于用户 token 生成
 */
export function extractSessionId(request: RequestData): string {
  // 尝试从消息历史中提取 conversation_id
  const conversationId = extractConversationId(request);
  if (conversationId) {
    return `conv_${conversationId}`;
  }

  // 尝试从 headers 中提取
  const sessionId = request.headers?.['x-session-id'];
  if (sessionId) {
    return `session_${sessionId}`;
  }

  // 降级方案：基于请求内容生成哈希
  const fallbackId = generateFallbackId(request);
  return `fallback_${fallbackId}`;
}

/**
 * 从 Claude Code 请求中提取 conversation_id
 */
function extractConversationId(request: RequestData): string | null {
  // Claude Code 的 conversation_id 通常在请求上下文中
  // 具体位置取决于请求格式
  if (request.conversation_id) {
    return request.conversation_id;
  }

  // 尝试从消息中提取
  const messages = request.body?.messages || [];
  if (messages.length > 0) {
    // 第一条消息通常包含会话信息
    const firstMessage = messages[0];
    if (firstMessage?.conversation_id) {
      return firstMessage.conversation_id;
    }
  }

  return null;
}

/**
 * 生成降级 ID (基于用户 token 或 IP)
 */
function generateFallbackId(request: RequestData): string {
  const crypto = require('crypto');

  // 尝试使用用户 token
  const token = request.headers?.['authorization'] || '';
  if (token) {
    return crypto.createHash('sha256').update(token).digest('hex').substring(0, 16);
  }

  // 降级使用 IP
  const ip = request.headers?.['x-forwarded-for'] || 'unknown';
  return crypto.createHash('sha256').update(ip).digest('hex').substring(0, 16);
}
```

---

## 验收标准

### SessionBinder
- [x] 绑定创建成功 ✅
- [x] TTL 过期后绑定失效 ✅
- [x] 账号受限时可以打破绑定 ✅
- [x] 定时清理过期绑定 ✅

### SessionId 提取
- [x] 正确提取 conversation_id ✅
- [x] 降级方案工作正常 ✅
- [x] 同一会话始终返回相同 ID ✅

**完成时间**: 2026-03-10
**状态**: ✅ 已完成

---

## 实现总结

### 新增文件
- `packages/core/src/utils/session-id.ts` - Session ID 提取工具函数
- `packages/core/src/services/session-binder.ts` - SessionBinder 会话绑定管理器

### 修改文件
- `packages/core/src/types/pool.ts` - 添加 updatedAt 字段到 SessionBinding
- `packages/core/src/services/pool-router.ts` - 使用 SessionBinder 替代内建 Map

### 核心功能
1. **extractSessionId()**: 从请求中提取会话 ID，支持 conversation_id、x-session-id header、降级生成
2. **SessionBinder 类**: 管理会话 - 账号绑定，支持 TTL 过期、自动清理、受限时解除绑定
3. **回调机制**: 支持 onBind、onUnbind、onAccountLimited 回调用于日志和监控

---

## 相关文件

- [Phase 2 计划](./README.md)
- [Phase 1 完成](../phase1/README.md)
- [主计划](../coding-plan-pool-implementation-plan.md)
