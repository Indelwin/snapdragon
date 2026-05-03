import { stderr, stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import type { LlmChatResponse } from '@snapdragon-ai/host';
import { contentWithAttachments, type PendingAttachment } from './attachments.js';
import { type CommandResult, handleCommand } from './commands.js';
import { maybeAutoCaptureMemory, requestInputWithMemory } from './memory.js';
import { RunRenderer } from './renderer.js';
import type { SdRuntime } from './runtime.js';
import { runtimeWarningLines } from './runtime-warnings.js';

export interface SdIo {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  error: NodeJS.WritableStream;
}
export const defaultIo: SdIo = { input: stdin, output: stdout, error: stderr };
export async function runOneShot(
  runtime: SdRuntime,
  prompt: string,
  attachments: PendingAttachment[] = [],
  io: SdIo = defaultIo,
  options: { requestInput?: string } = {},
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

export async function runInteractive(runtime: SdRuntime, io: SdIo = defaultIo): Promise<void> {
  const rl = createInterface({ input: io.input, output: io.output });
  let attachments: PendingAttachment[] = [];
  io.output.write(header(runtime));
  try {
    while (true) {
      const line = await rl.question('sd> ');
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('/')) {
        const result = await tryCommand(trimmed, runtime, attachments, io);
        attachments = result.attachments;
        if (result.prompt) await runCommandPrompt(runtime, result.prompt, io);
        if (result.quit) break;
        continue;
      }

      try {
        await runOneShot(runtime, trimmed, attachments, io);
        attachments = [];
      } catch (error) {
        io.error.write(`${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
  } finally {
    rl.close();
  }
}

export async function runCommandPrompt(
  runtime: SdRuntime,
  prompt: import('./skills.js').SkillInvocation,
  io: SdIo = defaultIo,
): Promise<LlmChatResponse> {
  runtime.session?.appendMeta(prompt.meta);
  return runOneShot(runtime, prompt.visibleInput, [], io, { requestInput: prompt.requestInput });
}

async function tryCommand(
  line: string,
  runtime: SdRuntime,
  attachments: PendingAttachment[],
  io: SdIo,
): Promise<CommandResult> {
  try {
    return await handleCommand(line, runtime, attachments, io);
  } catch (error) {
    io.error.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return { quit: false, attachments };
  }
}

function header(runtime: SdRuntime): string {
  const session = runtime.session ? `session ${runtime.session.sessionId}` : 'no session';
  const profile = runtime.profile ? `profile ${runtime.profile.name}` : 'no profile';
  return [
    `sd ${runtime.provider.id}/${runtime.provider.model} (${session}, ${profile})`,
    ...runtimeWarningLines(runtime),
    'Type /help for commands.',
    '',
  ].join('\n');
}

export { handleCommand, setReloadShellRunnerForTests } from './commands.js';
