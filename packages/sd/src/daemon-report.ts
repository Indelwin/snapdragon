import type { SdBackgroundServiceStatus } from './background.js';
import type { SdDaemonPaths } from './daemon-paths.js';
import type { SdDaemonStatus } from './daemon-status.js';
import type { SdRuntime } from './runtime.js';

export function formatDaemonStatus(
  paths: SdDaemonPaths,
  pid: number | undefined,
  running: boolean,
  status: SdDaemonStatus,
): string {
  const lines = [
    `daemon    ${running ? `running (${pid})` : 'stopped'}`,
    `root      ${paths.root}`,
    status.updated_at ? `updated   ${status.updated_at}` : undefined,
    status.channels ? channelStatusLine(status.channels) : undefined,
    ...status.services.map(serviceStatusLine),
  ];
  return `${lines.filter(Boolean).join('\n')}\n`;
}

export function formatServiceRuns(runtime: SdRuntime): string {
  return `${runtime.background.list().map(serviceRunLine).join('\n')}\n`;
}

function serviceStatusLine(service: SdBackgroundServiceStatus): string {
  return `service   ${service.name} ${service.enabled ? 'enabled' : 'disabled'} runs=${service.runs} errors=${service.errors}`;
}

function channelStatusLine(status: NonNullable<SdDaemonStatus['channels']>): string {
  const events = status.events
    ? ` events=${status.events.enabled ? 'enabled' : 'disabled'} events_root=${status.events.root}`
    : '';
  return `channels  ${status.enabled ? 'enabled' : 'disabled'} count=${status.count} root=${status.root}${events}`;
}

function serviceRunLine(service: SdBackgroundServiceStatus): string {
  return `${service.name}: runs=${service.runs} errors=${service.errors}`;
}
