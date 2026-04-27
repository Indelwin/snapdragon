import type { SdRuntime } from '../runtime.js';
import type { PromptCompletionState } from './input-completion.js';

export function skillSelection(runtime: SdRuntime): PromptCompletionState {
  const suggestions = runtime.skills.list().map((skill) => ({
    label: skill.id,
    description: `${skill.command} ${skill.description}`,
    insertText: `/skill ${skill.id}`,
    kind: 'skill' as const,
  }));
  return {
    mode: 'skill',
    query: '',
    selectedIndex: 0,
    suggestions,
  };
}
