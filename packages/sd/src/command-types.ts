import type { PendingAttachment } from './attachments.js';
import type { SdRestartRequest } from './reload.js';
import type { SkillInvocation } from './skills.js';

export interface CommandResult {
  quit: boolean;
  attachments: PendingAttachment[];
  prompt?: SkillInvocation;
  restart?: SdRestartRequest;
}

export interface SdCommandHooks {
  progress?: (label: string) => void;
  draft?: string;
}

export function commandEndsRun(result: CommandResult): boolean {
  return Boolean(result.restart) || result.quit;
}
