import type { Message } from '@snapdragon-ai/host';
import type { SdRuntime } from './runtime.js';

export function recordSystemCommand(runtime: SdRuntime, content: string): void {
  const message: Message = { role: 'system', content };
  runtime.agent.messages.push(message);
  runtime.session?.appendMessage(message, { meta: { source: 'sd.command' } });
}
