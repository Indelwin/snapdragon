import type { GatewayAgentRunSpec } from '@snapdragon-ai/gateway';
import type { SdCliArgs } from './args-types.js';
import { loadSdConfig } from './config.js';
import { gatewayErrorMessage, rustGatewayClientForConfig } from './gateway-command-client.js';
import { runHeadlessGatewayAgent } from './gateway-headless-agent.js';

export async function agentsCommand(
  action: string,
  rest: string[],
  args: SdCliArgs,
): Promise<string> {
  if (action === 'run') return runAgent(rest, args);
  if (action === 'enqueue') return enqueueAgent(rest, args);
  if (action === 'status') return agentStatus(rest[0], args);
  if (action === 'cancel') return cancelAgent(rest[0], args);
  return `Unknown gateway agents command: ${action}\n`;
}

async function runAgent(rest: string[], args: SdCliArgs): Promise<string> {
  const spec = agentSpecFromArgs(rest, args);
  if (!spec.prompt) return 'gateway agents run requires a prompt\n';
  const result = await runHeadlessGatewayAgent(spec, args);
  return `${result.summary ?? 'agent run complete'}\n`;
}

async function enqueueAgent(rest: string[], args: SdCliArgs): Promise<string> {
  const spec = agentSpecFromArgs(rest, args);
  if (!spec.prompt) return 'gateway agents enqueue requires a prompt\n';
  const config = await loadSdConfig(args.configPath);
  try {
    const job = await rustGatewayClientForConfig(config).enqueueJob({
      kind: 'agent.run',
      payload: spec,
      maxAttempts: 1,
    });
    return `enqueued agent job ${job.id}\n`;
  } catch (error) {
    return `Rust gateway unavailable: ${gatewayErrorMessage(error)}\n`;
  }
}

async function agentStatus(id: string | undefined, args: SdCliArgs): Promise<string> {
  if (!id) return 'gateway agents status requires <job-id>\n';
  const config = await loadSdConfig(args.configPath);
  try {
    const job = await rustGatewayClientForConfig(config).showJob(id);
    return job ? `${JSON.stringify(job, null, 2)}\n` : `Unknown agent job: ${id}\n`;
  } catch (error) {
    return `Rust gateway unavailable: ${gatewayErrorMessage(error)}\n`;
  }
}

async function cancelAgent(id: string | undefined, args: SdCliArgs): Promise<string> {
  if (!id) return 'gateway agents cancel requires <job-id>\n';
  const config = await loadSdConfig(args.configPath);
  try {
    const job = await rustGatewayClientForConfig(config).cancelJob(id);
    return job ? `cancelled agent job ${id}\n` : `Unknown agent job: ${id}\n`;
  } catch (error) {
    return `Rust gateway unavailable: ${gatewayErrorMessage(error)}\n`;
  }
}

function agentSpecFromArgs(rest: string[], args: SdCliArgs): GatewayAgentRunSpec {
  return {
    prompt: rest.join(' '),
    provider: args.provider,
    model: args.model,
    configPath: args.configPath,
    cwd: args.cwd,
    profile: args.profileName,
    session: 'new',
  };
}
