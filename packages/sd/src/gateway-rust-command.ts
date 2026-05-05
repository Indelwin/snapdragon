import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface RustGatewayCommand {
  bin: string;
  args: string[];
  cwd: string;
}

export function rustGatewayCommand(env: NodeJS.ProcessEnv = process.env): RustGatewayCommand {
  if (env.SNAPDRAGON_GATEWAY_DAEMON_BIN) {
    return { bin: env.SNAPDRAGON_GATEWAY_DAEMON_BIN, args: [], cwd: process.cwd() };
  }
  const root = repoRoot();
  return binaryCommand(root) ?? cargoCommand(root);
}

function binaryCommand(root: string): RustGatewayCommand | undefined {
  for (const profile of ['debug', 'release']) {
    const binary = join(root, 'target', profile, 'snapdragon-gateway-daemon');
    if (existsSync(binary)) return { bin: binary, args: [], cwd: root };
  }
  return undefined;
}

function cargoCommand(root: string): RustGatewayCommand {
  return {
    bin: 'cargo',
    args: ['run', '--quiet', '-p', 'snapdragon-gateway-daemon', '--'],
    cwd: root,
  };
}

function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
}
