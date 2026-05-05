import type { GatewayServiceStatus } from '@snapdragon-ai/gateway';
import type { SdConfig } from './config.js';

export function configuredServiceList(config: SdConfig): string {
  const configured = Object.entries(config.gateway?.services ?? {}).map(([name, service]) => {
    const enabled = service.enabled === false ? 'disabled' : 'enabled';
    return `${name}\t${enabled}\tinterval=${service.interval_ms ?? '-'} restart=${service.restart ?? '-'}`;
  });
  if (configured.length === 0) return 'No configured gateway services.\n';
  return `gateway services (configured)\n${configured.join('\n')}\n`;
}

export function formatLiveService(status: GatewayServiceStatus): string {
  const state = status.enabled ? status.state : 'disabled';
  const summary = status.lastSummary ? ` ${status.lastSummary}` : '';
  return `${status.name}\t${state}\truns=${status.runs} errors=${status.errors}${summary}`;
}
