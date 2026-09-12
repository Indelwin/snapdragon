import { spawn } from 'node:child_process';
import { BoundedOutputTail } from './bounded-output-tail.js';
import type { ReloadShellResult } from './reload-types.js';

export const defaultReloadShellRunner = (
  command: string,
  args: string[],
  cwd: string,
): Promise<ReloadShellResult> =>
  new Promise<ReloadShellResult>((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    const stdout = new BoundedOutputTail();
    const stderr = new BoundedOutputTail();
    child.stdout?.on('data', (chunk: Buffer) => stdout.append(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderr.append(chunk));
    child.on('close', (code) => resolve(result(stdout, stderr, code ?? 1)));
    child.on('error', (error) => {
      stderr.append(error.message);
      resolve(result(stdout, stderr, 1));
    });
  });

function result(
  stdout: BoundedOutputTail,
  stderr: BoundedOutputTail,
  code: number,
): ReloadShellResult {
  return { stdout: stdout.text(), stderr: stderr.text(), code };
}
