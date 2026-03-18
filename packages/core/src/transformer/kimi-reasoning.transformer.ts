import { UnifiedChatRequest } from "../types/llm";
import { Transformer } from "../types/transformer";

/**
 * Kimi Reasoning Transformer
 *
 * Kimi API requires `reasoning_content` on every assistant message when thinking
 * mode is enabled, including tool call messages. Claude Code doesn't include this
 * field on tool call assistant messages, causing:
 *   "thinking is enabled but reasoning_content is missing in assistant tool call message"
 *
 * This transformer adds an empty `reasoning_content` to any assistant message
 * that is missing it, using the thinking content if available.
 */
export class KimiReasoningTransformer implements Transformer {
  name = "kimi-reasoning";

  async transformRequestIn(
    request: UnifiedChatRequest
  ): Promise<UnifiedChatRequest> {
    // Kimi enables thinking mode implicitly via the model (e.g. kimi-for-coding),
    // so we unconditionally add reasoning_content to all assistant messages.
    // This transformer is only attached to the kimi provider config, so it's safe.

    for (const message of request.messages) {
      if (message.role === "assistant" && !(message as any).reasoning_content) {
        // Use a non-empty placeholder - Kimi rejects empty string as "missing"
        (message as any).reasoning_content = message.thinking?.content || " ";
      }
    }

    return request;
  }
}
