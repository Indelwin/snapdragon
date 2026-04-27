import type { SdRuntime } from '../runtime.js';
import type { PromptCompletionState } from './input-completion.js';
import { modelSelection } from './model-selection.js';
import { profileSelection } from './profile-selection.js';
import { providerSelection } from './provider-selection.js';
import { sessionSelection } from './session-selection.js';
import { skillSelection } from './skill-selection.js';

export interface PromptSelection {
  draft: string;
  completion: PromptCompletionState;
  warning?: string;
}

export async function selectionForLine(
  line: string,
  runtime: SdRuntime,
): Promise<PromptSelection | undefined> {
  const [commandName = '', ...rest] = line.trim().split(/\s+/);
  const arg = rest.join(' ').trim();
  if ((commandName === '/provider' || commandName === '/providers') && !arg) {
    return { draft: '/provider ', completion: providerSelection(runtime) };
  }
  if (commandName === '/model' && !arg) {
    return modelSelection(runtime, runtime.provider.id);
  }
  if (commandName === '/models') {
    return modelSelection(runtime, arg || runtime.provider.id);
  }
  if ((commandName === '/sessions' || commandName === '/resume') && !arg) {
    return { draft: '/resume ', completion: sessionSelection(runtime, '/resume') };
  }
  if (commandName === '/delete-session' && !arg) {
    return {
      draft: '/delete-session ',
      completion: sessionSelection(runtime, '/delete-session'),
    };
  }
  if ((commandName === '/profiles' || commandName === '/profile') && !arg) {
    return { draft: '/profile ', completion: profileSelection(runtime) };
  }
  if ((commandName === '/skills' || commandName === '/skill') && !arg) {
    return { draft: '/skill ', completion: skillSelection(runtime) };
  }
  return undefined;
}
