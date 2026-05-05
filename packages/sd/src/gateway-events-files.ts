import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  eventPath,
  isGatewayChannelEventDue,
  normalizeGatewayChannelEvent,
  type SdGatewayChannelEvent,
  type SdGatewayChannelEventClaim,
  type SdGatewayChannelEventInput,
  type SdGatewayChannelEventWriteResult,
} from './gateway-events-types.js';

export { completeGatewayChannelEvent } from './gateway-events-completion.js';

export async function writeSdGatewayChannelEvent(
  root: string,
  input: SdGatewayChannelEventInput,
): Promise<SdGatewayChannelEventWriteResult> {
  await ensureEventDirs(root);
  const event = normalizeGatewayChannelEvent(input);
  const path = eventPath(root, 'pending', event.id);
  await writeEvent(path, event);
  return { event, path };
}

export async function claimDueGatewayChannelEvents(
  root: string,
  nowMs: number,
  limit: number,
): Promise<SdGatewayChannelEventClaim[]> {
  await ensureEventDirs(root);
  const claims: SdGatewayChannelEventClaim[] = [];
  for (const path of await pendingEventPaths(root)) {
    if (claims.length >= limit) break;
    const event = await readEvent(path);
    if (!event || !isGatewayChannelEventDue(event, nowMs)) continue;
    const claim = await tryClaim(root, path, event);
    if (claim) claims.push(claim);
  }
  return claims;
}

export async function countPendingGatewayChannelEvents(root: string): Promise<number> {
  return (await pendingEventPaths(root)).length;
}

async function tryClaim(
  root: string,
  pendingPath: string,
  event: SdGatewayChannelEvent,
): Promise<SdGatewayChannelEventClaim | undefined> {
  const runningPath = eventPath(root, 'running', event.id);
  try {
    await rename(pendingPath, runningPath);
    return { event, pending_path: pendingPath, running_path: runningPath };
  } catch {
    return undefined;
  }
}

async function pendingEventPaths(root: string): Promise<string[]> {
  const pending = join(root, 'pending');
  if (!existsSync(pending)) return [];
  const names = await readdir(pending);
  return names
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => join(pending, name));
}

async function readEvent(path: string): Promise<SdGatewayChannelEvent | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as SdGatewayChannelEvent;
  } catch {
    return undefined;
  }
}

async function writeEvent(path: string, event: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(event, null, 2)}\n`);
}

async function ensureEventDirs(root: string): Promise<void> {
  await Promise.all(
    (['pending', 'running', 'done', 'failed'] as const).map((state) =>
      mkdir(join(root, state), { recursive: true }),
    ),
  );
}
