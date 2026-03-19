import crypto from 'crypto';

/**
 * Request data interface for session ID extraction
 */
export interface RequestWithSession {
  sessionId?: string;
  conversation_id?: string;
  headers?: Record<string, string>;
  body?: {
    messages?: any[];
    [key: string]: any;
  };
  [key: string]: any;
}

/**
 * Extract session ID from request
 *
 * Priority order:
 * 1. x-session-id header (custom, highest priority for user-supplied session IDs)
 * 2. conversation_id (Anthropic/Claude Code native)
 * 3. sessionId property (directly passed from router, lowest priority)
 * 4. Generate fallback ID from auth token or IP
 *
 * @param request - Request data
 * @returns Session ID string
 */
export function extractSessionId(request: RequestWithSession): string {
  // Priority 0: Extract from x-session-id header (highest priority for user-supplied session IDs)
  const sessionId = request.headers?.['x-session-id'];
  if (sessionId) {
    return `session_${sessionId}`;
  }

  // Priority 1: Extract conversation_id (Claude Code native)
  const conversationId = extractConversationId(request);
  if (conversationId) {
    return `conv_${conversationId}`;
  }

  // Priority 2: Use directly passed sessionId (from router.ts, lowest priority)
  if (request.sessionId) {
    return request.sessionId;
  }

  // Priority 3: Generate fallback ID from auth token or IP
  const fallbackId = generateFallbackId(request);
  return `fallback_${fallbackId}`;
}

/**
 * Extract conversation_id from Claude Code request
 *
 * Checks:
 * 1. request.conversation_id (direct property)
 * 2. request.body.messages[0].conversation_id (first message)
 *
 * @param request - Request data
 * @returns conversation_id or null
 */
function extractConversationId(request: RequestWithSession): string | null {
  // Check direct property (most common in Claude Code)
  if (request.conversation_id) {
    return request.conversation_id;
  }

  // Check first message for conversation_id
  const messages = request.body?.messages || [];
  if (messages.length > 0) {
    const firstMessage = messages[0];
    if (firstMessage?.conversation_id) {
      return firstMessage.conversation_id;
    }
  }

  return null;
}

/**
 * Generate fallback session ID from request
 *
 * Uses:
 * 1. Authorization token (hashed)
 * 2. IP address (hashed)
 * 3. Random ID (last resort)
 *
 * @param request - Request data
 * @returns 16-character hex string
 */
function generateFallbackId(request: RequestWithSession): string {
  // Try using authorization token
  const authHeader = request.headers?.['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    return createHash(token);
  }

  // Try using IP address
  const ip = request.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
             request.headers?.['x-real-ip'];
  if (ip) {
    return createHash(ip);
  }

  // Last resort: random ID
  return crypto.randomBytes(8).toString('hex');
}

/**
 * Create SHA256 hash of input string
 *
 * @param input - Input string to hash
 * @returns 16-character hex string
 */
function createHash(input: string): string {
  return crypto
    .createHash('sha256')
    .update(input)
    .digest('hex')
    .substring(0, 16);
}

/**
 * Generate a unique session ID (when no existing session is found)
 *
 * @returns Unique session ID with timestamp prefix
 */
export function generateSessionId(): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(8).toString('hex');
  return `session_${timestamp}_${random}`;
}

/**
 * Validate session ID format
 *
 * @param sessionId - Session ID to validate
 * @returns True if valid format
 */
export function isValidSessionId(sessionId: string): boolean {
  if (!sessionId || typeof sessionId !== 'string') {
    return false;
  }

  // Check for known prefixes
  const validPrefixes = ['conv_', 'session_', 'fallback_'];
  return validPrefixes.some(prefix => sessionId.startsWith(prefix));
}

/**
 * Extract session type from session ID
 *
 * @param sessionId - Session ID
 * @returns Session type: 'conversation' | 'session' | 'fallback' | 'unknown'
 */
export function getSessionType(sessionId: string): string {
  if (sessionId.startsWith('conv_')) {
    return 'conversation';
  }
  if (sessionId.startsWith('session_')) {
    return 'session';
  }
  if (sessionId.startsWith('fallback_')) {
    return 'fallback';
  }
  return 'unknown';
}
