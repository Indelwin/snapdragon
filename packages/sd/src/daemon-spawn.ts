import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import type { SdConfig } from './config.js';
import { daemonPathsForConfig } from './daemon-paths.js';
import { daemonPid, isPidAlive } from './daemon-status.js';
import type { SdRuntimeOptions } from './runtime-options.js';

export function ensureSdDaemonProcess(options: SdRuntimeOptions, config: SdConfig): string {
  const paths = daemonPathsForConfig(config);
  const pid = daemonPid(paths);
  if (pid && isPidAlive(pid)) return `sd daemon already running (${pid})`;

  const log = openSync(paths.log, 'a');
  const child = spawn(process.execPath, daemonArgs(options, process.argv[1] ?? 'sd'), {
    cwd: options.cwd,
    detached: true,
    stdio: ['ignore', log, log],
  });
  closeSync(log);
  child.unref();
  return `started sd daemon (${child.pid})`;
}

export function daemonArgs(options: SdRuntimeOptions, entrypoint: string): string[] {
  const args = [entrypoint, 'daemon', 'run'];
  if (options.configPath) args.push('--config', options.configPath);
  if (options.cwd) args.push('--cwd', options.cwd);
  if (options.profileName) args.push('--profile', options.profileName);
  if (options.noProfile) args.push('--no-profile');
  if (options.provider) args.push('--provider', options.provider);
  if (options.model) args.push('--model', options.model);
  return args;
}
