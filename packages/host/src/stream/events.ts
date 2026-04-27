import type { GeneratedImage, LlmChatResponse } from '../types.js';

export type StreamEvent =
  | { kind: 'started'; run_id: string; provider: string; role: string; model?: string }
  | { kind: 'text'; run_id: string; provider: string; delta: string }
  | { kind: 'thinking'; run_id: string; provider: string; delta: string }
  | { kind: 'tool_call_start'; run_id: string; provider: string; id: string; name: string }
  | { kind: 'input_json_delta'; run_id: string; provider: string; delta: string }
  | { kind: 'image_generation'; run_id: string; provider: string; image: GeneratedImage }
  | { kind: 'content_block_stop'; run_id: string; provider: string }
  | { kind: 'usage'; run_id: string; provider: string; input_tokens: number; output_tokens: number }
  | { kind: 'max_tokens_reached'; run_id: string; provider: string }
  | { kind: 'error'; run_id: string; provider: string; message: string }
  | { kind: 'done'; run_id: string; provider: string; response: LlmChatResponse };

export type StreamEmit = (event: StreamEvent) => void;

export function topicFor(event: StreamEvent): string {
  return `llm.stream.${event.kind}`;
}

export class StreamAggregator {
  #content = '';

  get content(): string {
    return this.#content;
  }

  accept(event: StreamEvent): void {
    if (event.kind === 'text') this.#content += event.delta;
  }
}
