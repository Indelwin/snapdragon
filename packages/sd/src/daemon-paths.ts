import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SD_DAEMON_ROOT, type SdConfig } from './config.js';

export interface SdDaemonPaths {
  root: string;
  pid: string;
  status: string;
  log: string;
  channels: string;
  events: string;
  gatewaySocket: string;
}

export function daemonPathsForConfig(config: SdConfig): SdDaemonPaths {
  return daemonPaths(
    config.gateway?.root ?? config.background?.daemon?.root ?? DEFAULT_SD_DAEMON_ROOT,
  );
}

export function daemonPaths(root = DEFAULT_SD_DAEMON_ROOT): SdDaemonPaths {
  mkdirSync(root, { recursive: true });
  return {
    root,
    pid: join(root, 'daemon.pid'),
    status: join(root, 'status.json'),
    log: join(root, 'daemon.log'),
    channels: join(root, 'channels'),
    events: join(root, 'events'),
    gatewaySocket: join(root, 'gateway.sock'),
  };
}
