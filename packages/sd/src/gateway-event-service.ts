import { mkdir, writeFile } from 'node:fs/promises';
import type {
  SdBackgroundChat,
  SdBackgroundContext,
  SdBackgroundService,
  SdBackgroundServiceResult,
} from './background.js';
import type { SdConfig } from './config.js';
import {
  eventMessages,
  eventSummary,
  failureResult,
  resultFileForEvent,
  resultMarkdown,
  summarizeChannelEventScan,
  truncateEventOutput,
} from './gateway-event-format.js';
import {
  claimDueGatewayChannelEvents,
  completeGatewayChannelEvent,
} from './gateway-events-files.js';
import {
  gatewayEventRootForConfig,
  type SdGatewayChannelEvent,
  type SdGatewayChannelEventClaim,
  type SdGatewayChannelEventResult,
} from './gateway-events-types.js';

export interface SdGatewayEventScanResult {
  claimed: number;
  completed: number;
  failed: number;
  requeued: number;
  errors: string[];
}

interface RunGatewayEventsOptions {
  ctx: SdBackgroundContext;
  root?: string;
}

export function channelEventService(): SdBackgroundService {
  return {
    name: 'channel-events',
    enabled: (ctx) => channelEventsEnabled(ctx),
    intervalMs: (ctx) => ctx.config.background?.channels?.events?.interval_ms ?? 60_000,
    startupDelayMs: (ctx) => ctx.config.background?.channels?.events?.startup_delay_ms ?? 2_000,
    async runOnce(ctx): Promise<SdBackgroundServiceResult> {
      const result = await runSdGatewayChannelEventsOnce({ ctx });
      return {
        summary: summarizeChannelEventScan(result),
        metrics: {
          claimed: result.claimed,
          completed: result.completed,
          failed: result.failed,
          requeued: result.requeued,
          errors: result.errors.length,
        },
      };
    },
  };
}

export async function runSdGatewayChannelEventsOnce(
  options: RunGatewayEventsOptions,
): Promise<SdGatewayEventScanResult> {
  const result: SdGatewayEventScanResult = {
    claimed: 0,
    completed: 0,
    failed: 0,
    requeued: 0,
    errors: [],
  };
  const { ctx } = options;
  if (!ctx.channels || !ctx.chat || !channelEventsEnabled(ctx)) return result;
  const root = options.root ?? gatewayEventRootForConfig(ctx.config);
  const limit = ctx.config.background?.channels?.events?.max_events_per_pass ?? 3;
  const claims = await claimDueGatewayChannelEvents(root, ctx.now(), limit);
  result.claimed = claims.length;
  for (const claim of claims) await runClaim(ctx, claim, result);
  return result;
}

function channelEventsEnabled(ctx: SdBackgroundContext): boolean {
  const channels = ctx.config.background?.channels;
  if (channels?.enabled === false) return false;
  if (channels?.events?.enabled === false) return false;
  return Boolean(ctx.channels && ctx.chat);
}

async function runClaim(
  ctx: SdBackgroundContext,
  claim: SdGatewayChannelEventClaim,
  scan: SdGatewayEventScanResult,
): Promise<void> {
  try {
    const result = await executeEvent(ctx, claim.event);
    const completion = await completeGatewayChannelEvent(claim, result, ctx.now());
    if (completion === 'requeued') scan.requeued += 1;
    else scan.completed += 1;
  } catch (error) {
    scan.failed += 1;
    scan.errors.push(error instanceof Error ? error.message : String(error));
    await completeGatewayChannelEvent(claim, failureResult(error), ctx.now());
  }
}

async function executeEvent(
  ctx: SdBackgroundContext,
  event: SdGatewayChannelEvent,
): Promise<SdGatewayChannelEventResult> {
  if (!ctx.channels || !ctx.chat) throw new Error('channel event service missing runtime handles');
  const channel = await ctx.channels.ensure(event.channel, {
    type: 'gateway',
    metadata: event.metadata,
  });
  await ctx.channels.appendLog(event.channel, { type: 'event.started', data: eventSummary(event) });
  const output = await runEventChat(ctx.chat, ctx.config, event);
  const resultFile = resultFileForEvent(channel, event);
  await mkdir(channel.logs, { recursive: true });
  await writeFile(resultFile, resultMarkdown(event, output));
  await ctx.channels.appendLog(event.channel, {
    type: 'event.completed',
    message: event.title,
    data: { id: event.id, result_file: resultFile },
  });
  return {
    status: 'done',
    completed_at: new Date().toISOString(),
    output: truncateEventOutput(output, ctx.config),
    result_file: resultFile,
  };
}

async function runEventChat(
  chat: SdBackgroundChat,
  config: SdConfig,
  event: SdGatewayChannelEvent,
): Promise<string> {
  const maxTokens = event.max_tokens ?? config.background?.channels?.events?.max_tokens ?? 4_000;
  const response = await chat(eventMessages(event, config), { max_tokens: maxTokens });
  return response.content;
}
