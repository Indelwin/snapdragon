import { stderr, stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import type { LlmChatResponse } from '@snapdragon-ai/host';
import { contentWithAttachments, type PendingAttachment } from './attachments.js';
import { handleCommand } from './commands.js';
import { RunRenderer } from './renderer.js';
import type { SdRuntime } from './runtime.js';

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
): Promise<LlmChatResponse> {
  const renderer = new RunRenderer(io);
  const unsubscribe = runtime.agent.subscribe((event) => renderer.accept(event));
  try {
    const response = await runtime.agent.prompt(contentWithAttachments(prompt, attachments));
    renderer.finish(response);
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

async function tryCommand(
  line: string,
  runtime: SdRuntime,
  attachments: PendingAttachment[],
  io: SdIo,
): Promise<{ quit: boolean; attachments: PendingAttachment[] }> {
  try {
    return await handleCommand(line, runtime, attachments, io);
  } catch (error) {
    io.error.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return { quit: false, attachments };
  }
}

function header(runtime: SdRuntime): string {
  const session = runtime.session ? `session ${runtime.session.sessionId}` : 'no session';
  return [
    `sd ${runtime.provider.id}/${runtime.provider.model} (${session})`,
    'Type /help for commands.',
    '',
  ].join('\n');
}

export { handleCommand } from './commands.js';
