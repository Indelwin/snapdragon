import type { GatewayAgentRuntimeObservedEvent, GatewayClient } from '@snapdragon-ai/gateway';

export async function appendRuntimeEventLog(
  client: GatewayClient,
  jobId: string,
  runtimeId: string,
  event: GatewayAgentRuntimeObservedEvent,
): Promise<void> {
  if (!shouldLogRuntimeEvent(event)) return;
  await safeAppendLog(client, {
    level: event.type === 'error' ? 'error' : 'info',
    target: jobId,
    message: `agent runtime event: ${event.type}`,
    data: {
      runtimeId,
      eventType: event.type,
      ...runtimeEventSummary(event),
    },
  });
}

export async function safeAppendLog(
  client: GatewayClient,
  input: Parameters<GatewayClient['appendLog']>[0],
): Promise<void> {
  try {
    await client.appendLog(input);
  } catch {
    // Job execution should not fail because observability storage is unavailable.
  }
}

function shouldLogRuntimeEvent(event: GatewayAgentRuntimeObservedEvent): boolean {
  return loggableRuntimeEvents.has(event.type);
}

const loggableRuntimeEvents = new Set([
  'agent_start',
  'agent_end',
  'message_end',
  'turn_end',
  'tool_execution_start',
  'tool_execution_end',
  'extension_ui_request',
  'error',
]);

function runtimeEventSummary(event: GatewayAgentRuntimeObservedEvent): Record<string, unknown> {
  const payload = event.payload;
  const summary: Record<string, unknown> = { atMs: event.atMs };
  copyString(payload, summary, 'id');
  copyString(payload, summary, 'method');
  copyString(payload, summary, 'title');
  copyString(payload, summary, 'toolName');
  copyString(payload, summary, 'toolCallId');
  if (Array.isArray(payload.messages)) summary.messageCount = payload.messages.length;
  if (isRecord(payload.message)) summary.message = messageSummary(payload.message);
  return summary;
}

function copyString(source: Record<string, unknown>, target: Record<string, unknown>, key: string) {
  if (typeof source[key] === 'string') target[key] = source[key];
}

function messageSummary(message: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  copyString(message, summary, 'role');
  const content = message.content;
  if (typeof content === 'string') {
    summary.preview = content.slice(0, 240);
  } else if (Array.isArray(content)) {
    summary.contentItems = content.length;
  }
  return summary;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
