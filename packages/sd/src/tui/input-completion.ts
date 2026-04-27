import { filterCommands, type SdTuiCommand } from './commands.js';

export interface PromptSuggestion {
  label: string;
  description: string;
  insertText: string;
  kind: 'command' | 'shell' | 'provider' | 'model' | 'session' | 'profile' | 'skill';
}

export interface PromptCompletionState {
  mode: 'slash' | 'shell' | 'provider' | 'model' | 'session' | 'profile' | 'skill';
  query: string;
  selectedIndex: number;
  suggestions: PromptSuggestion[];
  insertedDraft?: string;
}

export interface PromptCompletionCatalog {
  providers?: Array<{ id: string; kind: string; active?: boolean }>;
  models?: Array<{ id: string; active?: boolean }>;
  sessions?: Array<{ id: string; active?: boolean; updatedAt?: number }>;
  profiles?: Array<{ id: string; active?: boolean; description?: string; valid?: boolean }>;
  skills?: Array<{ id: string; command: string; description?: string }>;
}

export function buildPromptCompletion(
  draft: string,
  commands: readonly SdTuiCommand[],
  shellCommands: readonly string[],
  catalog: PromptCompletionCatalog = {},
  selectedIndex = 0,
): PromptCompletionState | undefined {
  if (draft.startsWith('/')) {
    return slashCompletion(draft, commands, catalog, selectedIndex);
  }
  if (draft.startsWith('!')) {
    return shellCompletion(draft, shellCommands, selectedIndex);
  }
  return undefined;
}

export function completePromptDraft(
  draft: string,
  commands: readonly SdTuiCommand[],
  shellCommands: readonly string[],
  current: PromptCompletionState | undefined,
  catalog: PromptCompletionCatalog = {},
): { draft: string; completion: PromptCompletionState } | undefined {
  const cycling = current?.insertedDraft === draft;
  const base = current ?? buildPromptCompletion(draft, commands, shellCommands, catalog);
  if (!base || base.suggestions.length === 0) return undefined;
  const selectedIndex = (base.selectedIndex + Number(cycling)) % base.suggestions.length;
  const suggestion = base.suggestions[selectedIndex];
  if (!suggestion) return undefined;
  const nextDraft = suggestion.insertText;
  return {
    draft: nextDraft,
    completion: {
      ...base,
      selectedIndex,
      insertedDraft: nextDraft,
    },
  };
}

export function movePromptCompletion(
  current: PromptCompletionState | undefined,
  direction: -1 | 1,
): PromptCompletionState | undefined {
  if (!current || current.suggestions.length === 0) return undefined;
  const count = current.suggestions.length;
  return {
    ...current,
    selectedIndex: (current.selectedIndex + direction + count) % count,
    insertedDraft: undefined,
  };
}

export function selectedPromptSuggestion(
  current: PromptCompletionState | undefined,
): PromptSuggestion | undefined {
  if (!current || current.suggestions.length === 0) return undefined;
  return current.suggestions[current.selectedIndex];
}

function slashCompletion(
  draft: string,
  commands: readonly SdTuiCommand[],
  catalog: PromptCompletionCatalog,
  selectedIndex: number,
): PromptCompletionState | undefined {
  const argCompletion = slashArgumentCompletion(draft, catalog, selectedIndex);
  if (argCompletion) return argCompletion;
  if (draft.includes(' ')) return undefined;
  const query = draft.slice(1);
  const suggestions = filterCommands(commands, query).map((command) => ({
    label: command.name,
    description: command.description,
    insertText: command.name,
    kind: 'command' as const,
  }));
  return clampCompletion({ mode: 'slash', query, selectedIndex, suggestions });
}

function slashArgumentCompletion(
  draft: string,
  catalog: PromptCompletionCatalog,
  selectedIndex: number,
): PromptCompletionState | undefined {
  const [command, ...rest] = draft.split(/\s+/);
  if (!command) return undefined;
  if (!draft.includes(' ') && !supportsBareArgumentCompletion(command)) return undefined;
  const query = rest.join(' ').toLowerCase();
  if (command === '/provider' || command === '/providers') {
    const providers = (catalog.providers ?? []).filter(
      (provider) => !query || provider.id.toLowerCase().startsWith(query),
    );
    const suggestions = providers.map((provider) => ({
      label: provider.id,
      description: `${provider.kind}${provider.active ? ' active' : ''}`,
      insertText: `/provider ${provider.id}`,
      kind: 'provider' as const,
    }));
    return clampCompletion({
      mode: 'provider',
      query,
      selectedIndex: preferredActiveIndex(selectedIndex, providers),
      suggestions,
    });
  }
  if (command === '/model') {
    const modelEntries = (catalog.models ?? []).filter(
      (model) => !query || model.id.toLowerCase().startsWith(query),
    );
    const suggestions = modelEntries.map((model) => ({
      label: model.id,
      description: model.active ? 'active model' : 'model',
      insertText: `/model ${model.id}`,
      kind: 'model' as const,
    }));
    return clampCompletion({
      mode: 'model',
      query,
      selectedIndex: preferredActiveIndex(selectedIndex, modelEntries),
      suggestions,
    });
  }
  if (command === '/resume' || command === '/delete-session') {
    const sessionEntries = (catalog.sessions ?? []).filter(
      (session) => !query || session.id.toLowerCase().startsWith(query),
    );
    const suggestions = sessionEntries.map((session) => ({
      label: session.id,
      description: sessionDescription(session),
      insertText: `${command} ${session.id}`,
      kind: 'session' as const,
    }));
    return clampCompletion({
      mode: 'session',
      query,
      selectedIndex: preferredActiveIndex(selectedIndex, sessionEntries),
      suggestions,
    });
  }
  if (command === '/profile') {
    const profileEntries = (catalog.profiles ?? []).filter(
      (profile) => !query || profile.id.toLowerCase().startsWith(query),
    );
    const suggestions = profileEntries.map((profile) => ({
      label: profile.id,
      description: profileDescription(profile),
      insertText: `/profile ${profile.id}`,
      kind: 'profile' as const,
    }));
    return clampCompletion({
      mode: 'profile',
      query,
      selectedIndex: preferredActiveIndex(selectedIndex, profileEntries),
      suggestions,
    });
  }
  if (command === '/skill') {
    const skillEntries = (catalog.skills ?? []).filter(
      (skill) =>
        !query ||
        skill.id.toLowerCase().startsWith(query) ||
        skill.command.toLowerCase().startsWith(query),
    );
    const suggestions = skillEntries.map((skill) => ({
      label: skill.id,
      description: skill.description ?? 'skill',
      insertText: `/skill ${skill.id}`,
      kind: 'skill' as const,
    }));
    return clampCompletion({ mode: 'skill', query, selectedIndex, suggestions });
  }
  return undefined;
}

function preferredActiveIndex(selectedIndex: number, entries: Array<{ active?: boolean }>): number {
  if (selectedIndex !== 0) return selectedIndex;
  const activeIndex = entries.findIndex((entry) => entry.active === true);
  return activeIndex < 0 ? selectedIndex : activeIndex;
}

function supportsBareArgumentCompletion(command: string): boolean {
  return (
    command === '/provider' ||
    command === '/providers' ||
    command === '/model' ||
    command === '/resume' ||
    command === '/delete-session' ||
    command === '/profile' ||
    command === '/skill'
  );
}

function sessionDescription(session: { active?: boolean; updatedAt?: number }): string {
  const updated = session.updatedAt ? new Date(session.updatedAt * 1000).toISOString() : 'session';
  return [session.active ? 'active' : '', updated].filter(Boolean).join(' ');
}

function profileDescription(profile: {
  active?: boolean;
  description?: string;
  valid?: boolean;
}): string {
  if (profile.valid === false) return profile.description ?? 'invalid profile';
  return [profile.active ? 'active' : '', profile.description ?? 'profile']
    .filter(Boolean)
    .join(' ');
}

function shellCompletion(
  draft: string,
  shellCommands: readonly string[],
  selectedIndex: number,
): PromptCompletionState | undefined {
  const body = draft.slice(1);
  if (/\s/.test(body)) return undefined;
  const query = body.toLowerCase();
  const suggestions = shellCommands
    .filter((name) => !query || name.toLowerCase().startsWith(query))
    .slice(0, 24)
    .map((name) => ({
      label: name,
      description: 'shell command',
      insertText: `!${name}`,
      kind: 'shell' as const,
    }));
  return clampCompletion({ mode: 'shell', query: body, selectedIndex, suggestions });
}

function clampCompletion(completion: PromptCompletionState): PromptCompletionState {
  const maxIndex = Math.max(0, completion.suggestions.length - 1);
  return {
    ...completion,
    selectedIndex: Math.max(0, Math.min(maxIndex, completion.selectedIndex)),
  };
}
