import { contentText, normalizeContent } from '../content.js';
import type { Message } from '../types.js';
import type { NormalizedAnthropicPromptCachingOptions } from './anthropic-cache.js';
import {
  applyStableMessageCacheBreakpoint,
  anthropicSystemContent as cachedSystemContent,
} from './anthropic-cache-apply.js';
import { anthropicContentBlock } from './anthropic-media.js';
import { signedThinkingBlocks } from './anthropic-thinking.js';
import { safeJson } from './json.js';

const MISSING_TOOL_RESULT_STUB = '[unknown error, tool result missing]';

/**
 * Convert an abstract Message[] to the Anthropic Messages API `messages` array,
 * repairing common shape violations along the way. Anthropic strictly requires:
 *
 *   1. Every assistant `tool_use` block must be followed by a user message
 *      containing a matching `tool_result` for the same `tool_use_id`.
 *   2. Roles must alternate (no two consecutive `user` or `assistant` messages).
 *   3. The first non-system message must be `user`.
 *
 * Real conversations — especially resumed sessions where a tool call was
 * interrupted — frequently violate (1). Multi-part user input or a stray text
 * after a tool result violates (2). Rather than letting the API 400 (which then
 * makes the session unrecoverable until the user manually edits the JSONL),
 * synthesize stubs and merge same-role neighbours so the generation can
 * proceed. The model sees the stub and can recover.
 */
export function convertMessagesToAnthropic(
  messages: Message[],
  cache?: NormalizedAnthropicPromptCachingOptions,
): Array<Record<string, unknown>> {
  const repaired = repairToolResultPairs(messages.filter((m) => m.role !== 'system'));
  const converted = repaired
    .map(convertMessageToAnthropic)
    .filter((m): m is Record<string, unknown> => m !== null);
  const merged = mergeConsecutiveSameRole(converted);
  // Drop any leading non-user messages — Anthropic requires conversations start
  // with `user`. In practice this only fires if the very first turn is somehow
  // an assistant or stray tool message after repair (e.g. malformed session).
  while (merged.length > 0 && merged[0].role !== 'user') merged.shift();
  applyStableMessageCacheBreakpoint(merged, cache);
  return merged;
}

function repairToolResultPairs(messages: Message[]): Message[] {
  // First pass: figure out which tool_call ids are claimed by some assistant
  // message. Tool messages whose id doesn't match any claim are orphans and get
  // dropped (they'd otherwise become user-role tool_result blocks referencing
  // unknown ids, which Anthropic also rejects).
  const claimedIds = new Set<string>();
  for (const m of messages) {
    if (m.role === 'assistant' && m.tool_calls) {
      for (const c of m.tool_calls) claimedIds.add(c.id);
    }
  }

  const out: Message[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i];
    if (msg.role === 'tool') {
      if (msg.tool_call_id && claimedIds.has(msg.tool_call_id)) out.push(msg);
      continue;
    }
    out.push(msg);
    if (msg.role !== 'assistant' || !msg.tool_calls || msg.tool_calls.length === 0) continue;

    // Collect tool results that immediately follow this assistant message and
    // match its tool_use ids. Anything in between (e.g. a stray user message)
    // means the pair is broken; we synthesize stubs for any missing ids and
    // emit them right after the assistant message.
    const expected = new Set(msg.tool_calls.map((c) => c.id));
    const provided = new Set<string>();
    let j = i + 1;
    while (j < messages.length && messages[j].role === 'tool') {
      const tm = messages[j];
      if (tm.tool_call_id && expected.has(tm.tool_call_id)) {
        provided.add(tm.tool_call_id);
        out.push(tm);
      }
      // (orphan tool messages are dropped above on the main loop's next pass)
      j += 1;
    }
    i = j - 1;
    for (const call of msg.tool_calls) {
      if (provided.has(call.id)) continue;
      out.push({
        role: 'tool',
        tool_call_id: call.id,
        content: MISSING_TOOL_RESULT_STUB,
      });
    }
  }
  return out;
}

function mergeConsecutiveSameRole(
  messages: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const merged: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === m.role) {
      prev.content = [...asBlockArray(prev.content), ...asBlockArray(m.content)];
      continue;
    }
    // Clone so mutation above doesn't reach back into the source array.
    merged.push({ ...m, content: asBlockArray(m.content) });
  }
  return merged;
}

function asBlockArray(content: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(content)) return content as Array<Record<string, unknown>>;
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (content == null) return [];
  return [content as Record<string, unknown>];
}

export function convertMessageToAnthropic(message: Message): Record<string, unknown> | null {
  if (message.role === 'system') return null;
  if (message.role === 'tool') {
    return {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: message.tool_call_id,
          content: contentText(message.content),
        },
      ],
    };
  }
  if (message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0) {
    return assistantToolUseMessage(message);
  }
  return {
    role: message.role,
    content: normalizeContent(message.content).map(anthropicContentBlock),
  };
}

export function anthropicSystem(messages: Message[]): string | undefined {
  const text = messages
    .filter((message) => message.role === 'system')
    .map((message) => contentText(message.content))
    .filter(Boolean)
    .join('\n\n');
  return text.length > 0 ? text : undefined;
}

export function anthropicSystemContent(
  messages: Message[],
  cache?: NormalizedAnthropicPromptCachingOptions,
): string | Array<Record<string, unknown>> | undefined {
  return cachedSystemContent(anthropicSystem(messages), cache);
}

function assistantToolUseMessage(message: Message): Record<string, unknown> {
  const content: Array<Record<string, unknown>> = [];
  for (const block of signedThinkingBlocks(message.thinking)) {
    content.push({ type: 'thinking', thinking: block.text, signature: block.signature });
  }
  content.push(...normalizeContent(message.content).map(anthropicContentBlock));
  for (const call of message.tool_calls ?? []) {
    content.push({
      type: 'tool_use',
      id: call.id,
      name: call.name,
      input: safeJson<Record<string, unknown>>(call.args_json) ?? {},
    });
  }
  return { role: 'assistant', content };
}

// Media block conversion lives in `anthropic-media.ts`.
// Stable-message cache breakpoint helper lives in `anthropic-cache-apply.ts`.
