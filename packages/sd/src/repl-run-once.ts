import type { LlmChatResponse } from '@snapdragon-ai/host';
import { contentWithAttachments, type PendingAttachment } from './attachments.js';
import { maybeAutoCaptureMemory, requestInputWithMemory } from './memory.js';
import { RunRenderer } from './renderer.js';
import { defaultIo, type SdIo } from './repl-io.js';
import type { SdRuntime } from './runtime.js';

export async function runOneShot(
  runtime: SdRuntime,
  prompt: string,
  attachments: PendingAttachment[] = [],
  io: SdIo = defaultIo,
  options: { requestInput?: string; signal?: AbortSignal } = {},
): Promise<LlmChatResponse> {
  const renderer = new RunRenderer(io);
  const unsubscribe = runtime.agent.subscribe((event) => renderer.accept(event));
  try {
    const visibleInput = contentWithAttachments(prompt, attachments);
    const response = await runtime.agent.prompt(visibleInput, {
      requestInput: await requestInputWithMemory(
        runtime.config,
        runtime.memory,
        visibleInput,
        options.requestInput,
      ),
      signal: options.signal,
    });
    renderer.finish(response);
    await maybeAutoCaptureMemory({
      config: runtime.config,
      memory: runtime.memory,
      visibleInput,
      response,
      source: 'sd.repl',
      sessionAppendMeta: (meta) => runtime.session?.appendMeta(meta),
    });
    return response;
  } finally {
    unsubscribe();
  }
}

export async function runCommandPrompt(
  runtime: SdRuntime,
  prompt: import('./skills.js').SkillInvocation,
  io: SdIo = defaultIo,
  signal?: AbortSignal,
): Promise<LlmChatResponse> {
  runtime.session?.appendMeta(prompt.meta);
  return runOneShot(runtime, prompt.visibleInput, [], io, {
    requestInput: prompt.requestInput,
    signal,
  });
}
