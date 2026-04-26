import { resolve } from 'node:path';
import { DEFAULT_SD_CONFIG_PATH } from './config.js';

export type SdCliMode = 'run' | 'help' | 'version' | 'setup';

export interface SdCliArgs {
  mode: SdCliMode;
  provider?: string;
  model?: string;
  cwd: string;
  configPath: string;
  sessionId?: string;
  newSession: boolean;
  noSession: boolean;
  prompt?: string;
}

export function parseArgs(argv: string[], cwd = process.cwd()): SdCliArgs {
  const out: SdCliArgs = {
    mode: 'run',
    cwd,
    configPath: DEFAULT_SD_CONFIG_PATH,
    newSession: false,
    noSession: false,
  };
  const promptParts: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (raw === '--') {
      promptParts.push(...argv.slice(i + 1));
      break;
    }
    const { flag, value } = splitFlag(raw);
    switch (flag) {
      case '--help':
      case '-h':
        out.mode = 'help';
        break;
      case '--version':
      case '-v':
        out.mode = 'version';
        break;
      case '--setup':
        out.mode = 'setup';
        break;
      case '--provider':
        out.provider = value ?? expectValue(argv, ++i, flag);
        break;
      case '--model':
        out.model = value ?? expectValue(argv, ++i, flag);
        break;
      case '--cwd':
        out.cwd = resolve(value ?? expectValue(argv, ++i, flag));
        break;
      case '--config':
        out.configPath = resolve(value ?? expectValue(argv, ++i, flag));
        break;
      case '--session':
        out.sessionId = value ?? expectValue(argv, ++i, flag);
        break;
      case '--new-session':
        out.newSession = true;
        break;
      case '--no-session':
        out.noSession = true;
        break;
      default:
        if (raw.startsWith('-')) throw new Error(`Unknown option: ${raw}`);
        promptParts.push(raw);
    }
  }

  if (promptParts.length > 0) out.prompt = promptParts.join(' ');
  return out;
}

function splitFlag(raw: string): { flag: string; value?: string } {
  const index = raw.indexOf('=');
  if (index <= 0 || !raw.startsWith('-')) return { flag: raw };
  return { flag: raw.slice(0, index), value: raw.slice(index + 1) };
}

function expectValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}
