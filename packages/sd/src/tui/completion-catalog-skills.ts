import type { SdRuntime } from '../runtime.js';
import type { PromptCompletionCatalog } from './input-completion.js';

export function skillCompletionCatalog(runtime: SdRuntime): PromptCompletionCatalog {
  return {
    skills: runtime.skills.list().map((skill) => ({
      id: skill.id,
      command: skill.command,
      description: skill.description,
    })),
  };
}
