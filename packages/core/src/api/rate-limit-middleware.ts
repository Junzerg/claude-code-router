import { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Check if an error response indicates rate limiting
 * @param reply - Fastify reply object
 * @returns True if response indicates rate limiting
 */
export function isRateLimitError(reply: FastifyReply): boolean {
  const statusCode = reply.statusCode;
  const body = reply.raw as any;

  // Check HTTP status codes
  if (statusCode === 429) {
    return true; // Too Many Requests
  }

  // Try to parse response body for rate limit indicators
  try {
    if (body && typeof body === 'object') {
      const errorMessage = (body.error || body.message || '').toLowerCase();
      const errorCode = (body.type || body.code || '').toLowerCase();

      // Check for rate limit error keywords
      const rateLimitKeywords = [
        'rate_limit',
        'rate limit',
        'requests limit',
        'request limit',
        'too many requests',
        'quota exceeded',
        'quota exhausted',
      ];

      if (rateLimitKeywords.some((keyword) => errorMessage.includes(keyword))) {
        return true;
      }

      // Check for specific Z.ai error types
      if (
        errorCode === 'rate_limit_exceeded' ||
        errorCode === 'too_many_requests' ||
        errorCode === 'quota_exhausted' ||
        errorCode === 'insufficient_quota' ||
        errorCode === 'concurrent_limit_reached'
      ) {
        return true;
      }
    }
  } catch (error) {
    // Failed to parse body, ignore
  }

  return false;
}

/**
 * Fastify hook wrapper for onSend
 *
 * NOTE: Rate limit errors are now handled by RetryManager for automatic account switching.
 * This hook is kept for non-retryable rate limit scenarios or monitoring purposes.
 *
 * This function can be registered as an onSend hook to intercept responses
 * and handle rate limit errors automatically.
 */
export const rateLimitHook = async (
  req: FastifyRequest,
  reply: FastifyReply,
  payload: any
): Promise<void> => {
  // Store the response body in reply.raw for later inspection
  if (payload && typeof payload === 'object') {
    (reply.raw as any).body = payload;
  }

  // Only check for requests to API endpoints
  const url = new URL(`http://127.0.0.1${req.url}`);
  if (
    !url.pathname.endsWith('/v1/messages') &&
    !url.pathname.endsWith('/v1/chat/completions')
  ) {
    return;
  }

  // Check if this is a rate limit error
  if (!isRateLimitError(reply)) {
    return;
  }

  // Rate limit errors are handled by RetryManager for automatic account switching.
  // This hook is mainly for logging and monitoring purposes now.
  const accountId = (req as any).poolAccount?.id;
  const sessionId = (req as any).sessionId;

  if (accountId) {
    console.log(
      `[RateLimitMiddleware] Rate limit detected for account ${accountId}${sessionId ? `, session ${sessionId}` : ''}`
    );
  }
};
