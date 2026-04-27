import { spawn } from 'node:child_process';

export interface InlineShellResult {
  command: string;
  content: string;
  exitCode: number | null;
  timedOut: boolean;
  isError: boolean;
}

export interface InlineShellOptions {
  cwd: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export function runInlineShellCommand(
  command: string,
  options: InlineShellOptions,
): Promise<InlineShellResult> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxOutputBytes = options.maxOutputBytes ?? 64_000;
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: options.cwd,
      env: process.env,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let timedOut = false;
    const append = (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.length > maxOutputBytes) output = output.slice(0, maxOutputBytes);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    child.on('close', (code) => {
      clearTimeout(timer);
      const truncated = output.length >= maxOutputBytes;
      const suffix = timedOut
        ? `\n[timeout after ${timeoutMs}ms]`
        : truncated
          ? '\n[truncated]'
          : '';
      const content = `${output}${suffix}`.trimEnd() || `(exit ${code ?? 'unknown'}, no output)`;
      resolve({
        command,
        content,
        exitCode: code,
        timedOut,
        isError: timedOut || (code ?? 0) !== 0,
      });
    });
  });
}
