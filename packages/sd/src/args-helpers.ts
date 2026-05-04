import type { SdCliArgs, SdCliMode } from './args-types.js';
import { DEFAULT_SD_CONFIG_PATH } from './config.js';
import { isRunMode } from './modes.js';

const modeFlags = new Map<string, SdCliMode>([
  ['--help', 'help'],
  ['-h', 'help'],
  ['--version', 'version'],
  ['-v', 'version'],
  ['--setup', 'setup'],
  ['--repl', 'repl'],
  ['--tui', 'tui'],
  ['--print', 'print'],
  ['--list-sessions', 'list-sessions'],
  ['--list-profiles', 'list-profiles'],
]);

export interface ParsedFlag {
  flag: string;
  value: string | undefined;
}

export function defaultArgs(cwd: string): SdCliArgs {
  return {
    mode: 'tui',
    cwd,
    configPath: DEFAULT_SD_CONFIG_PATH,
    newSession: false,
    noSession: false,
    resume: false,
    noProfile: false,
  };
}

export function splitFlag(raw: string): ParsedFlag {
  const index = raw.indexOf('=');
  if (index <= 0 || !raw.startsWith('-')) return { flag: raw, value: undefined };
  return { flag: raw.slice(0, index), value: raw.slice(index + 1) };
}

export function modeForFlag(flag: string): SdCliMode | undefined {
  return modeFlags.get(flag);
}

export function takeValue(
  current: string | undefined,
  argv: string[],
  index: number,
  flag: string,
): { value: string; index: number } {
  if (current) return { value: current, index };
  const value = argv[index + 1];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return { value, index: index + 1 };
}

export function addPromptPart(raw: string, out: SdCliArgs, promptParts: string[]): void {
  if (raw.startsWith('-')) throw new Error(`Unknown option: ${raw}`);
  if (promptParts.length === 0 && isRunMode(raw)) {
    out.mode = raw;
  } else {
    promptParts.push(raw);
  }
}

export function applyPrompt(out: SdCliArgs, promptParts: string[]): void {
  if (promptParts.length === 0) return;
  out.prompt = promptParts.join(' ');
  if (out.mode === 'tui') out.mode = 'print';
}
