import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { statusByName } from './background-empty.js';
import type { SdBackgroundServiceStatus, SdBackgroundServicesHandle } from './background-types.js';
import type { SdConfig } from './config.js';
import { daemonPathsForConfig, type SdDaemonPaths } from './daemon-paths.js';

export interface SdDaemonStatus {
  pid?: number;
  started_at?: string;
  updated_at?: string;
  config_path?: string;
  cwd?: string;
  services: SdBackgroundServiceStatus[];
  channels?: SdDaemonChannelStatus;
  error?: string;
}

export interface SdDaemonChannelStatus {
  enabled: boolean;
  root: string;
  count: number;
  events?: {
    enabled: boolean;
    root: string;
  };
}

export function daemonBackedBackgroundHandle(config: SdConfig): SdBackgroundServicesHandle {
  const paths = daemonPathsForConfig(config);
  return {
    stop() {},
    async flush() {},
    async runNow(name) {
      return statusByName(readDaemonStatus(paths).services, name);
    },
    list() {
      return readDaemonStatus(paths).services;
    },
    status(name) {
      return statusByName(readDaemonStatus(paths).services, name);
    },
    rebindStores() {},
  };
}

export function readDaemonStatus(paths: SdDaemonPaths): SdDaemonStatus {
  if (!existsSync(paths.status)) return { services: [] };
  try {
    const parsed = JSON.parse(readFileSync(paths.status, 'utf8')) as Partial<SdDaemonStatus>;
    return { services: [], ...parsed };
  } catch {
    return { services: [], error: 'status unreadable' };
  }
}

export function writeDaemonStatus(paths: SdDaemonPaths, status: SdDaemonStatus): void {
  writeFileSync(paths.status, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
}

export function daemonPid(paths: SdDaemonPaths): number | undefined {
  if (!existsSync(paths.pid)) return undefined;
  const pid = Number(readFileSync(paths.pid, 'utf8').trim());
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
