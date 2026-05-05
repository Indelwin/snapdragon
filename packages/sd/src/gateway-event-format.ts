import { join } from 'node:path';
import type { Message } from '@snapdragon-ai/host';
import type { SdConfig } from './config.js';
import type { SdGatewayChannelDescriptor } from './gateway-channels.js';
import type { SdGatewayChannelEvent, SdGatewayChannelEventResult } from './gateway-events-types.js';

export function eventMessages(event: SdGatewayChannelEvent, config: SdConfig): Message[] {
  return [
    { role: 'system', content: systemPrompt() },
    { role: 'user', content: eventPrompt(event, config) },
  ];
}

export function resultFileForEvent(
  channel: SdGatewayChannelDescriptor,
  event: SdGatewayChannelEvent,
): string {
  return join(channel.logs, `${event.id}.md`);
}

export function resultMarkdown(event: SdGatewayChannelEvent, output: string): string {
  return [`# ${event.title ?? event.id}`, '', `Channel: ${event.channel}`, '', output, ''].join(
    '\n',
  );
}

export function eventSummary(event: SdGatewayChannelEvent): Record<string, unknown> {
  return {
    id: event.id,
    type: event.type,
    title: event.title,
    at: event.at,
    next_at: event.next_at,
  };
}

export function failureResult(error: unknown): SdGatewayChannelEventResult {
  return {
    status: 'failed',
    completed_at: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
  };
}

export function truncateEventOutput(output: string, config: SdConfig): string {
  const max = config.background?.channels?.events?.max_response_chars ?? 24_000;
  return output.length > max ? `${output.slice(0, max)}\n...` : output;
}

export function summarizeChannelEventScan(result: {
  claimed: number;
  completed: number;
  failed: number;
  requeued: number;
}): string {
  if (result.claimed === 0) return 'no due channel events';
  return `processed ${result.claimed} channel event(s), completed ${result.completed}, requeued ${result.requeued}, failed ${result.failed}`;
}

function eventPrompt(event: SdGatewayChannelEvent, config: SdConfig): string {
  return [
    `Channel: ${event.channel}`,
    `Event: ${event.id}`,
    event.title ? `Title: ${event.title}` : undefined,
    '',
    truncatedPrompt(event, config),
  ]
    .filter((line) => line !== undefined)
    .join('\n');
}

function truncatedPrompt(event: SdGatewayChannelEvent, config: SdConfig): string {
  const maxChars = config.background?.channels?.events?.max_prompt_chars ?? 50_000;
  return event.prompt.length > maxChars ? `${event.prompt.slice(0, maxChars)}\n...` : event.prompt;
}

function systemPrompt(): string {
  return [
    'You are running a Snapdragon gateway channel event.',
    'Return a concise result for the channel log.',
    'Do not assume interactive follow-up is available.',
  ].join('\n');
}
