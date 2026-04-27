import {
  addPromptPart,
  applyPrompt,
  applyValueFlag,
  defaultArgs,
  isValueFlag,
  modeForFlag,
  splitFlag,
  takeValue,
} from './args-helpers.js';
import type { SdCliArgs } from './args-types.js';
import { parseRunMode } from './modes.js';

export function parseArgs(argv: string[], cwd = process.cwd()): SdCliArgs {
  const out = defaultArgs(cwd);
  const promptParts: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (raw === '--') {
      promptParts.push(...argv.slice(i + 1));
      break;
    }

    const parsed = splitFlag(raw);
    const mode = modeForFlag(parsed.flag);
    if (mode) {
      out.mode = mode;
      continue;
    }

    if (parsed.flag === '--mode') {
      const taken = takeValue(parsed.value, argv, i, parsed.flag);
      out.mode = parseRunMode(taken.value);
      i = taken.index;
      continue;
    }

    if (isValueFlag(parsed.flag)) {
      const taken = takeValue(parsed.value, argv, i, parsed.flag);
      applyValueFlag(out, parsed.flag, taken.value);
      i = taken.index;
      continue;
    }

    if (parsed.flag === '--new-session') {
      out.newSession = true;
      continue;
    }
    if (parsed.flag === '--no-session') {
      out.noSession = true;
      continue;
    }
    if (parsed.flag === '--resume') {
      out.resume = true;
      continue;
    }
    if (parsed.flag === '--no-profile') {
      out.noProfile = true;
      continue;
    }
    addPromptPart(raw, out, promptParts);
  }

  applyPrompt(out, promptParts);
  return out;
}

export type { SdCliArgs, SdCliMode } from './args-types.js';
