#!/usr/bin/env node
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { createCodingReplAgent } from '@snapdragon-ai/agent';
import { anthropicProvider, mockProvider, openaiProvider } from '@snapdragon-ai/host';
import { isDirectEntrypoint } from './entrypoint.js';

interface CliArgs {
  provider: 'mock' | 'openai' | 'anthropic';
  model?: string;
  cwd: string;
  prompt?: string;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const provider = makeProvider(args);
  const agent = await createCodingReplAgent({
    provider,
    cwd: args.cwd,
  });
  agent.subscribe((event) => {
    if (event.type === 'tool_start') {
      output.write(`\n[tool] ${event.call.name}\n`);
    }
    if (event.type === 'tool_end' && event.isError) {
      output.write(`[tool-error] ${event.content}\n`);
    }
  });

  if (args.prompt) {
    const response = await agent.prompt(args.prompt);
    output.write(`${response.content}\n`);
    return;
  }

  const rl = createInterface({ input, output });
  try {
    while (true) {
      const line = await rl.question('snapdragon> ');
      if (line.trim() === '' || line.trim() === '/quit') break;
      const response = await agent.prompt(line);
      output.write(`${response.content}\n`);
    }
  } finally {
    rl.close();
  }
}

function parseArgs(argv: string[]): CliArgs {
  let provider: CliArgs['provider'] = process.env.ANTHROPIC_API_KEY
    ? 'anthropic'
    : process.env.OPENAI_API_KEY
      ? 'openai'
      : 'mock';
  let model: string | undefined;
  let cwd = process.cwd();
  const promptParts: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--provider') {
      provider = expectValue(argv, ++i, '--provider') as CliArgs['provider'];
    } else if (arg === '--model') {
      model = expectValue(argv, ++i, '--model');
    } else if (arg === '--cwd') {
      cwd = expectValue(argv, ++i, '--cwd');
    } else {
      promptParts.push(arg);
    }
  }

  return {
    provider,
    model,
    cwd,
    prompt: promptParts.length > 0 ? promptParts.join(' ') : undefined,
  };
}

function makeProvider(args: CliArgs) {
  if (args.provider === 'mock') {
    const mock = mockProvider();
    mock.enqueue('mock response');
    return mock.handler;
  }
  if (args.provider === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is required for --provider openai');
    return openaiProvider({
      apiKey,
      model: args.model ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    });
  }
  if (args.provider === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required for --provider anthropic');
    return anthropicProvider({
      apiKey,
      model: args.model ?? process.env.ANTHROPIC_MODEL ?? 'claude-3-5-haiku-latest',
    });
  }
  throw new Error(`Unsupported provider: ${args.provider}`);
}

function expectValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

if (isDirectEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
