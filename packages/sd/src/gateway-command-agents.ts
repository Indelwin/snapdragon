import type { SdCliArgs } from './args-types.js';
import { loadSdConfig } from './config.js';
import { agentSpecFromArgs } from './gateway-agent-command-args.js';
import { runGatewayAgentRuntime } from './gateway-agent-dispatch.js';
import {
  listAgentRuntimes,
  probePiRuntime,
  registerPiRuntime,
  showAgentRuntime,
} from './gateway-agent-runtime-commands.js';
import { registerSavedAgentRuntime } from './gateway-agent-runtime-resolve.js';
import { gatewayErrorMessage, rustGatewayClientForConfig } from './gateway-command-client.js';

type AgentCommandHandler = (rest: string[], args: SdCliArgs) => Promise<string>;

const agentCommandHandlers: Record<string, AgentCommandHandler> = {
  cancel: (rest, args) => cancelAgent(rest[0], args),
  enqueue: enqueueAgent,
  list: (_rest, args) => listAgentRuntimes(args),
  'probe-pi': (rest) => probePiRuntime(rest),
  'register-pi': registerPiRuntime,
  run: runAgent,
  show: (rest, args) => showAgentRuntime(rest[0], args),
  status: (rest, args) => agentStatus(rest[0], args),
};

export async function agentsCommand(
  action: string,
  rest: string[],
  args: SdCliArgs,
): Promise<string> {
  const handler = agentCommandHandlers[action];
  return handler ? handler(rest, args) : `Unknown gateway agents command: ${action}\n`;
}

async function runAgent(rest: string[], args: SdCliArgs): Promise<string> {
  const spec = agentSpecFromArgs(rest, args);
  if (!spec.prompt) return 'gateway agents run requires a prompt\n';
  const result = await runGatewayAgentRuntime(spec, { args });
  return `${result.summary ?? 'agent run complete'}\n`;
}

async function enqueueAgent(rest: string[], args: SdCliArgs): Promise<string> {
  const spec = agentSpecFromArgs(rest, args);
  if (!spec.prompt) return 'gateway agents enqueue requires a prompt\n';
  const config = await loadSdConfig(args.configPath);
  try {
    const client = rustGatewayClientForConfig(config);
    if (spec.targetRuntimeId) {
      await registerSavedAgentRuntime(client, config, spec.targetRuntimeId);
    }
    const job = await client.enqueueJob({
      kind: 'agent.run',
      payload: spec,
      maxAttempts: 1,
    });
    return `enqueued agent job ${job.id} runtime=${spec.targetRuntimeId ?? 'sd'}\n`;
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
