import type { GatewayAgentRunSpec } from '@snapdragon-ai/gateway';
import type { SdCliArgs } from './args-types.js';
import { runOneShot } from './repl.js';
import { createSdRuntime, stopSdRuntime } from './runtime.js';

export interface HeadlessGatewayAgentResult {
  summary?: string;
  content: string;
  metrics: Record<string, number>;
}

export async function runHeadlessGatewayAgent(
  spec: GatewayAgentRunSpec,
  args: SdCliArgs = {} as SdCliArgs,
): Promise<HeadlessGatewayAgentResult> {
  const runtime = await createSdRuntime({
    ...args,
    configPath: spec.configPath ?? args.configPath,
    provider: spec.provider ?? args.provider,
    model: spec.model ?? args.model,
    cwd: spec.cwd ?? args.cwd,
    profileName: spec.profile ?? args.profileName,
    noBackground: true,
    noSession: spec.session === 'none',
  });
  try {
    const response = await runOneShot(runtime, spec.prompt);
    return {
      summary: summarizeAgentOutput(response.content),
      content: response.content,
      metrics: {
        input_tokens: response.tokens_in ?? 0,
        output_tokens: response.tokens_out ?? 0,
      },
    };
  } finally {
    stopSdRuntime(runtime);
  }
}

function summarizeAgentOutput(content: string): string {
  const firstLine = content.trim().split(/\r?\n/, 1)[0] ?? '';
  return firstLine.length > 160 ? `${firstLine.slice(0, 157)}...` : firstLine;
}
