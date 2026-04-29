import { execFileSync } from 'node:child_process';
import type { AgentEvent, SnapdragonAgent } from '@snapdragon-ai/agent';
import type { Message, StreamEvent, ToolCall } from '@snapdragon-ai/host';
import { type JsonObject, type JsonValue, type UiEvent, UiWorld, uiLog } from '@snapdragon-ai/ui';
import type { PendingAttachment } from '../attachments.js';
import type { SdRuntime } from '../runtime.js';
import { listRuntimeSessions } from '../runtime-session.js';
import type { PromptCompletionState } from './input-completion.js';
import { promptCompletionJson } from './prompt-completion-json.js';
import { ProviderEventBuffer } from './provider-event-buffer.js';
import { resolveSplashImagePath } from './splash-art.js';
import { chatEntries, eventEntries, toolEntries } from './state-readers.js';
import type { ChatEntry, ToolEntry } from './ui-entry.js';

export const SD_UI_IDS = {
  chat: 'sd.chat',
  splash: 'sd.splash',
  prompt: 'sd.prompt',
  keybinds: 'sd.keybinds',
  palette: 'sd.palette',
  runStatus: 'sd.run-status',
  toolPanel: 'sd.tool-panel',
  eventLog: 'sd.event-log',
  sessionStatus: 'sd.session-status',
} as const;

export type SdUiComponentKind =
  | 'chat.transcript'
  | 'splash.banner'
  | 'prompt.input'
  | 'keybind.bar'
  | 'command.palette'
  | 'run.status'
  | 'tool.panel'
  | 'event.log'
  | 'session.status';

export interface SdUiControllerOptions {
  maxEntries?: number;
  maxLogEntries?: number;
}

export class SdUiController {
  readonly world: UiWorld;
  readonly runtime: SdRuntime;
  #activeRunId: string | undefined;
  #currentAssistantId: string | undefined;
  #assistantSequence = 0;
  #providerTurnText = '';
  #providerEvents: ProviderEventBuffer;
  #maxEntries: number;
  #maxLogEntries: number;
  #boundAgent: SnapdragonAgent | undefined;
  #unsubscribeAgent: (() => void) | undefined;
  #activeAbort: AbortController | undefined;

  constructor(runtime: SdRuntime, world = new UiWorld(), options: SdUiControllerOptions = {}) {
    this.runtime = runtime;
    this.world = world;
    this.#providerEvents = new ProviderEventBuffer((events) => this.#flushProviderEvents(events));
    this.#maxEntries = options.maxEntries ?? 80;
    this.#maxLogEntries = options.maxLogEntries ?? 80;
    this.world.applyMany(initialSdUiEvents(runtime));
    if (runtime.agent.messages.length > 0) this.loadRuntimeTranscript();
  }

  get activeRunId(): string | undefined {
    return this.#activeRunId;
  }

  get isRunning(): boolean {
    return this.#activeRunId !== undefined;
  }

  bindRuntimeAgent(): void {
    if (this.#boundAgent === this.runtime.agent) return;
    this.#unsubscribeAgent?.();
    this.#boundAgent = this.runtime.agent;
    this.#unsubscribeAgent = this.runtime.agent.subscribe((event) => this.acceptAgentEvent(event));
  }

  dispose(): void {
    this.#providerEvents.flush();
    this.#unsubscribeAgent?.();
    this.#unsubscribeAgent = undefined;
    this.#boundAgent = undefined;
  }

  acceptAgentEvent(event: AgentEvent): void {
    if (this.#providerEvents.accept(event)) return;
    this.#providerEvents.flush();
    this.world.applyMany(this.agentEventToUiEvents(event));
  }

  agentEventToUiEvents(event: AgentEvent): UiEvent[] {
    if (event.type === 'run_start') return this.#runStart(event.runId);
    if (event.type === 'provider_event') return this.#providerEventToUiEvents(event.event);
    if (event.type === 'message') return this.#messageToUiEvents(event.message);
    if (event.type === 'tool_start') return this.#toolStartEvents(event.call);
    if (event.type === 'tool_end') {
      return this.#toolEndEvents(event.call, event.content, event.isError);
    }
    return this.#runEnd(event.runId);
  }

  setPromptDraft(draft: string): void {
    this.world.apply(patch(SD_UI_IDS.prompt, { draft }));
  }

  setPromptInput(draft: string, completion: PromptCompletionState | undefined): void {
    this.world.apply(
      patch(SD_UI_IDS.prompt, {
        draft,
        completion: promptCompletionJson(completion),
      }),
    );
  }

  setPromptCompletion(completion: PromptCompletionState | undefined): void {
    this.world.apply(patch(SD_UI_IDS.prompt, { completion: promptCompletionJson(completion) }));
  }

  setPromptHistory(history: readonly string[]): void {
    this.world.apply(patch(SD_UI_IDS.prompt, { history: [...history] }));
  }

  setAttachments(attachments: readonly PendingAttachment[]): void {
    this.world.apply(
      patch(SD_UI_IDS.prompt, {
        attachments: attachments.map((attachment) => attachment.label),
      }),
    );
  }

  /**
   * Resolve the user's `splash.png` (profile-level first, then the
   * sd-root override) and patch the file path into splash component
   * state. The `<SplashBanner>` renderer hands that path to
   * `ink-picture`'s `<Image>` component, which handles scaling and
   * ASCII rendering inline. We only do path resolution here so the
   * controller stays sync — there's nothing async to fail or wait on.
   * If neither candidate exists the splash keeps showing the ASCII
   * cat banner.
   */
  loadSplashArt(): void {
    const imagePath = resolveSplashImagePath({ profile: this.runtime.profile });
    if (!imagePath) return;
    this.world.apply(patch(SD_UI_IDS.splash, { imagePath }));
  }

  refreshRuntimeStatus(): void {
    this.world.applyMany([
      patch(SD_UI_IDS.sessionStatus, sessionState(this.runtime)),
      patch(SD_UI_IDS.splash, {
        provider: this.runtime.provider.id,
        model: this.runtime.provider.model,
        profile: this.runtime.profile?.name ?? 'none',
        stats: runtimeStats(this.runtime),
      }),
      patch(SD_UI_IDS.runStatus, {
        provider: this.runtime.provider.id,
        model: this.runtime.provider.model,
        profile: this.runtime.profile?.name ?? 'none',
      }),
      this.#eventEntryEvent(
        'info',
        `provider active: ${this.runtime.provider.id}/${this.runtime.provider.model}`,
        'provider',
      ),
    ]);
  }

  setPalette(args: {
    open: boolean;
    query?: string;
    selectedIndex?: number;
    commands?: readonly JsonObject[];
  }): void {
    this.world.apply(
      patch(SD_UI_IDS.palette, {
        open: args.open,
        query: args.query ?? '',
        selectedIndex: args.selectedIndex ?? 0,
        ...(args.commands ? { commands: [...args.commands] } : {}),
      }),
    );
  }

  toggleEventPanel(): void {
    const state = this.world.componentState(SD_UI_IDS.eventLog);
    this.world.apply(patch(SD_UI_IDS.eventLog, { open: state.open === false }));
  }

  /**
   * Show the running spinner + shimmering label for a long-running slash
   * command (e.g. `/reload sync`). Reuses the same prompt UI machinery the
   * agent loop drives, just with a free-form `phase: 'task'` so the
   * renderer prints `phaseLabel` verbatim. Pair with `endTask()`.
   */
  beginTask(label: string): void {
    this.world.apply(patch(SD_UI_IDS.prompt, { running: true, phase: 'task', phaseLabel: label }));
  }

  updateTask(label: string): void {
    this.world.apply(patch(SD_UI_IDS.prompt, { phase: 'task', phaseLabel: label }));
  }

  endTask(): void {
    this.world.apply(patch(SD_UI_IDS.prompt, { running: false, phase: null, phaseLabel: null }));
  }

  appendCommandOutput(text: string, level: 'info' | 'error' = 'info'): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    const role = level === 'error' ? 'error' : 'system';
    this.world.applyMany([
      this.#appendChat({
        id: makeId('command'),
        role,
        content: trimmed,
        isError: level === 'error',
      }),
      this.#eventEntryEvent(level, trimmed, 'command'),
      logEvent(level, trimmed, 'command'),
    ]);
  }

  clearChat(): void {
    this.world.apply(patch(SD_UI_IDS.chat, { entries: [] }));
  }

  loadRuntimeTranscript(): void {
    const entries = this.runtime.agent.messages.map(messageToEntry);
    this.world.applyMany([
      patch(SD_UI_IDS.chat, { entries: trimEntries(entries, this.#maxEntries) }),
      patch(SD_UI_IDS.splash, { visible: entries.length === 0 }),
      patch(SD_UI_IDS.sessionStatus, sessionState(this.runtime)),
    ]);
  }

  markRunError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.#activeRunId = undefined;
    this.#currentAssistantId = undefined;
    this.#activeAbort = undefined;
    this.world.applyMany([
      patch(SD_UI_IDS.runStatus, { status: 'error', error: message }),
      patch(SD_UI_IDS.prompt, { running: false, phase: null, phaseLabel: null }),
      this.#eventEntryEvent('error', message, 'agent'),
      logEvent('error', message, 'agent'),
    ]);
  }

  /**
   * Register the AbortController for the in-flight `agent.prompt()` so the
   * TUI can cancel the run on Esc without exiting the process. Cleared
   * automatically when the run ends (success or error).
   */
  setActiveAbortController(controller: AbortController | undefined): void {
    this.#activeAbort = controller;
  }

  /**
   * Cancel the active run, if any. Safe to call when no run is in flight.
   * Returns true iff an abort was actually issued — callers (the keymap)
   * can use this to decide whether to swallow the keystroke.
   */
  abortActiveRun(): boolean {
    const ac = this.#activeAbort;
    if (!ac || !this.#activeRunId) return false;
    this.#activeAbort = undefined;
    ac.abort();
    this.world.applyMany([
      this.#eventEntryEvent('info', 'run cancelled by user (esc)', 'agent'),
      logEvent('info', 'run cancelled by user (esc)', 'agent'),
    ]);
    return true;
  }

  #runStart(runId: string): UiEvent[] {
    this.#activeRunId = runId;
    this.#currentAssistantId = undefined;
    this.#assistantSequence = 0;
    this.#providerTurnText = '';
    return [
      patch(SD_UI_IDS.runStatus, { status: 'running', runId, error: null }),
      patch(SD_UI_IDS.prompt, { running: true, phase: 'connecting', phaseLabel: null }),
      patch(SD_UI_IDS.splash, { visible: false }),
      this.#eventEntryEvent('info', `run started: ${runId}`, 'agent'),
      logEvent('info', `run started: ${runId}`, 'agent'),
    ];
  }

  #runEnd(runId: string): UiEvent[] {
    const assistantId = this.#currentAssistantId;
    this.#activeRunId = undefined;
    this.#currentAssistantId = undefined;
    this.#providerTurnText = '';
    this.#activeAbort = undefined;
    const events: UiEvent[] = [
      patch(SD_UI_IDS.runStatus, { status: 'done', runId, error: null }),
      patch(SD_UI_IDS.prompt, { running: false, phase: null, phaseLabel: null }),
      this.#eventEntryEvent('info', `run finished: ${runId}`, 'agent'),
      logEvent('info', `run finished: ${runId}`, 'agent'),
    ];
    if (assistantId) events.unshift(this.#markChatEntryStreaming(assistantId, false));
    return events;
  }

  #providerEventToUiEvents(event: StreamEvent): UiEvent[] {
    if (event.kind === 'text') {
      return [this.#appendAssistantText(event.delta), this.#phasePatch('streaming')];
    }
    if (event.kind === 'thinking') {
      return [this.#appendAssistantThinking(event.delta), this.#phasePatch('thinking')];
    }
    if (event.kind === 'tool_call_start') return this.#providerToolStartEvents(event);
    if (event.kind === 'usage') return this.#usageEvents(event);
    if (event.kind === 'started') return this.#providerStartedEvents(event);
    if (event.kind === 'max_tokens_reached') {
      return this.#logEvents('warn', 'provider reached max_tokens', 'provider');
    }
    if (event.kind === 'error') return this.#providerErrorEvents(event.message, event.provider);
    if (event.kind === 'input_json_delta') {
      return [patch(SD_UI_IDS.runStatus, { toolArgsStreaming: true })];
    }
    return [];
  }

  #phasePatch(phase: 'connecting' | 'thinking' | 'tool' | 'streaming', label?: string): UiEvent {
    return patch(SD_UI_IDS.prompt, { phase, phaseLabel: label ?? null });
  }

  #providerStartedEvents(event: Extract<StreamEvent, { kind: 'started' }>): UiEvent[] {
    this.#providerTurnText = '';
    return [
      patch(SD_UI_IDS.runStatus, { provider: event.provider, model: event.model ?? null }),
      this.#phasePatch('connecting'),
      this.#eventEntryEvent('info', `stream started: ${event.provider}`, 'provider'),
    ];
  }

  #providerToolStartEvents(event: Extract<StreamEvent, { kind: 'tool_call_start' }>): UiEvent[] {
    return [
      this.#upsertTool({ id: event.id, name: event.name, status: 'running' }),
      this.#phasePatch('tool', event.name),
      this.#eventEntryEvent('info', `tool call: ${event.name}`, 'provider'),
    ];
  }

  #usageEvents(event: Extract<StreamEvent, { kind: 'usage' }>): UiEvent[] {
    return [
      patch(SD_UI_IDS.runStatus, {
        usage: { inputTokens: event.input_tokens, outputTokens: event.output_tokens },
      }),
      this.#eventEntryEvent(
        'info',
        `usage in:${event.input_tokens} out:${event.output_tokens}`,
        'provider',
      ),
    ];
  }

  #messageToUiEvents(message: Message): UiEvent[] {
    const sessionPatch = this.#sessionMessageCountEvent();
    if (message.role === 'assistant' && this.#activeRunId) {
      return this.#assistantFinalEvents(message).concat(sessionPatch);
    }
    if (message.role === 'tool' && this.#activeRunId) return sessionPatch;
    return [
      this.#appendChat(messageToEntry(message)),
      patch(SD_UI_IDS.splash, { visible: false }),
    ].concat(sessionPatch);
  }

  #assistantFinalEvents(message: Message): UiEvent[] {
    const entry = this.#ensureAssistantEntry();
    const summary = messageContentSummary(message);
    if (summary.trim()) this.#providerTurnText = summary;
    return [
      this.#replaceChatEntry({
        ...entry,
        content: summary.trim() ? summary : entry.content,
        streaming: true,
        toolCalls: (entry.toolCalls ?? 0) + (message.tool_calls?.length ?? 0),
      }),
    ];
  }

  #toolStartEvents(call: ToolCall): UiEvent[] {
    return [
      this.#upsertTool({ id: call.id, name: call.name, status: 'running' }),
      this.#phasePatch('tool', call.name),
      this.#eventEntryEvent('info', `tool started: ${call.name}`, 'tool'),
      logEvent('info', `tool started: ${call.name}`, 'tool'),
    ];
  }

  #toolEndEvents(call: ToolCall, content: string, isError: boolean): UiEvent[] {
    const level = isError ? 'error' : 'info';
    return [
      this.#upsertTool({
        id: call.id,
        name: call.name,
        status: isError ? 'error' : 'done',
        content,
      }),
      this.#appendChat({
        id: `tool_${call.id}`,
        role: 'tool',
        content,
        isError,
        toolName: call.name,
        toolStatus: isError ? 'error' : 'done',
      }),
      this.#eventEntryEvent(level, `tool finished: ${call.name}`, 'tool', content),
      logEvent(level, `tool finished: ${call.name}`, 'tool'),
    ];
  }

  #appendAssistantText(delta: string): UiEvent {
    this.#providerTurnText += delta;
    const entry = this.#ensureAssistantEntry();
    entry.content = this.#providerTurnText;
    entry.streaming = true;
    return this.#replaceChatEntry(entry);
  }

  #appendAssistantThinking(delta: string): UiEvent {
    const entry = this.#ensureAssistantEntry();
    entry.thinking = `${entry.thinking ?? ''}${delta}`;
    return this.#replaceChatEntry(entry);
  }

  #ensureAssistantEntry(): ChatEntry {
    const entries = chatEntries(this.world.componentState(SD_UI_IDS.chat));
    const current = entries.find((entry) => entry.id === this.#currentAssistantId);
    if (current) return current;
    const entry: ChatEntry = {
      id: this.#nextAssistantId(),
      role: 'assistant',
      content: '',
      streaming: true,
    };
    this.#currentAssistantId = entry.id;
    this.world.apply(this.#appendChat(entry));
    return entry;
  }

  #nextAssistantId(): string {
    this.#assistantSequence += 1;
    return `assistant_${this.#activeRunId ?? Date.now()}_${this.#assistantSequence}`;
  }

  #replaceChatEntry(entry: ChatEntry): UiEvent {
    const currentEntries = chatEntries(this.world.componentState(SD_UI_IDS.chat));
    const entries =
      entry.role === 'assistant' && this.#activeRunId
        ? [...currentEntries.filter((candidate) => candidate.id !== entry.id), entry]
        : currentEntries.map((candidate) => (candidate.id === entry.id ? entry : candidate));
    return patch(SD_UI_IDS.chat, { entries: trimEntries(entries, this.#maxEntries) });
  }

  #appendChat(entry: ChatEntry): UiEvent {
    const entries = chatEntries(this.world.componentState(SD_UI_IDS.chat));
    return patch(SD_UI_IDS.chat, {
      entries: trimEntries([...entries, entry], this.#maxEntries),
    });
  }

  #upsertTool(tool: ToolEntry): UiEvent {
    const tools = toolEntries(this.world.componentState(SD_UI_IDS.toolPanel));
    const next = upsertTool(tools, tool).slice(-20).map(toolEntryToJson);
    return patch(SD_UI_IDS.toolPanel, { tools: next });
  }

  #eventEntryEvent(
    level: 'info' | 'warn' | 'error',
    message: string,
    source: string,
    detail?: string,
  ): UiEvent {
    const entries = eventEntries(this.world.componentState(SD_UI_IDS.eventLog)).map(
      eventEntryToJson,
    );
    return patch(SD_UI_IDS.eventLog, {
      entries: [...entries, makeEvent(level, message, source, detail)].slice(-this.#maxLogEntries),
    });
  }

  #markChatEntryStreaming(id: string, streaming: boolean): UiEvent {
    const entries = chatEntries(this.world.componentState(SD_UI_IDS.chat)).map((entry) =>
      entry.id === id ? { ...entry, streaming } : entry,
    );
    return patch(SD_UI_IDS.chat, { entries: trimEntries(entries, this.#maxEntries) });
  }

  #logEvents(level: 'info' | 'warn' | 'error', message: string, source: string): UiEvent[] {
    return [this.#eventEntryEvent(level, message, source), logEvent(level, message, source)];
  }

  /**
   * Surface a provider-side error both in the event log AND as an
   * inline chat row, so the user sees it without having to flip the
   * events panel open. Without the chat row, a stream that ended with
   * empty content rendered as a silent `(empty)` row even when the
   * provider had emitted a clear error event upstream.
   */
  #providerErrorEvents(message: string, provider: string): UiEvent[] {
    return [
      this.#appendChat({
        id: `error_${this.#activeRunId ?? Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        role: 'error',
        content: `${provider}: ${message}`,
        isError: true,
      }),
      this.#eventEntryEvent('error', message, provider),
      logEvent('error', message, provider),
    ];
  }

  #sessionMessageCountEvent(): UiEvent[] {
    if (!this.runtime.session) return [];
    return [
      patch(SD_UI_IDS.sessionStatus, {
        session: {
          id: this.runtime.session.sessionId,
          path: this.runtime.session.jsonlPath,
          messages: this.runtime.session.messages().length,
        },
      }),
    ];
  }

  #flushProviderEvents(events: readonly StreamEvent[]): void {
    this.world.applyMany(
      events.flatMap((event) => this.agentEventToUiEvents({ type: 'provider_event', event })),
    );
  }
}

export function initialSdUiEvents(runtime: SdRuntime): UiEvent[] {
  return [
    register(SD_UI_IDS.sessionStatus, 'session.status', 'status', 0, sessionState(runtime)),
    register(SD_UI_IDS.runStatus, 'run.status', 'status', 1, { status: 'idle' }),
    register(SD_UI_IDS.splash, 'splash.banner', 'main', -1, {
      visible: true,
      title: 'Snapdragon',
      subtitle: 'Batteries-included coding agent',
      provider: runtime.provider.id,
      model: runtime.provider.model,
      profile: runtime.profile?.name ?? 'none',
      cwd: runtime.agent.cwd,
      stats: runtimeStats(runtime),
    }),
    register(SD_UI_IDS.chat, 'chat.transcript', 'main', 0, { entries: [] }),
    register(SD_UI_IDS.toolPanel, 'tool.panel', 'panel', 0, { tools: [], open: true }),
    register(SD_UI_IDS.eventLog, 'event.log', 'panel', 1, { entries: [], open: false }),
    register(SD_UI_IDS.palette, 'command.palette', 'overlay', 0, {
      open: false,
      query: '',
      selectedIndex: 0,
      commands: [],
    }),
    register(SD_UI_IDS.prompt, 'prompt.input', 'input', 0, {
      draft: '',
      running: false,
      attachments: [],
      history: [],
    }),
    register(SD_UI_IDS.keybinds, 'keybind.bar', 'footer', 0, {
      binds: [
        { keys: 'enter', label: 'send' },
        { keys: 'shift-enter', label: 'newline' },
        { keys: 'up/down', label: 'select/history' },
        { keys: 'pgup/dn', label: 'scroll' },
        { keys: 'ctrl-p', label: 'palette' },
        { keys: 'ctrl-e', label: 'events' },
        { keys: 'ctrl-c', label: 'quit' },
      ],
    }),
    { type: 'ui.focus.set', id: SD_UI_IDS.prompt },
  ];
}

function register(
  id: string,
  kind: SdUiComponentKind,
  slot: string,
  order: number,
  state: JsonObject,
): UiEvent {
  return {
    type: 'ui.component.register',
    descriptor: { id, kind, slot, order },
    state,
  };
}

/**
 * Snapshot of runtime "what's loaded" counts for the splash stats
 * panel. Everything here is synchronous (no network, no async file
 * walks beyond what `readFileSync` already does), so we re-run it on
 * every `refreshRuntimeStatus` to stay current after skill reloads,
 * profile switches, etc.
 */
function runtimeStats(runtime: SdRuntime): JsonObject {
  const reasoning = runtime.config.agent?.reasoning;
  return {
    tools: runtime.agent.registry.listDefinitions().length,
    skills: runtime.skills.list().length,
    profiles: runtime.profileStore.list().length,
    services: runtime.background.list().length,
    extensions: runtime.extensions.list().length,
    sessions: countSessionsSafely(runtime),
    memories: countMemoriesSafely(runtime),
    git: gitStatus(runtime.agent.cwd),
    reasoning: reasoning?.enabled === false ? 'off' : (reasoning?.effort ?? 'medium'),
    contextTokens: runtime.config.agent?.context?.max_request_tokens ?? null,
    outputTokens: runtime.config.agent?.max_tokens ?? null,
  };
}

function countSessionsSafely(runtime: SdRuntime): number {
  try {
    return listRuntimeSessions(runtime.config).length;
  } catch {
    return 0;
  }
}

function countMemoriesSafely(runtime: SdRuntime): number {
  try {
    const result = runtime.memory.read();
    // Default `SdMemoryStore.read` is synchronous; some custom
    // providers return a Promise. We don't await here because the
    // splash render happens once and a hanging memory provider
    // shouldn't delay it.
    if (result instanceof Promise) return 0;
    return result.entries.length;
  } catch {
    return 0;
  }
}

function gitStatus(cwd: string): JsonObject | null {
  // Cheap, best-effort: bail silently if the cwd isn't a git checkout
  // or if git is missing. We never want a slow/missing git to delay
  // the splash render.
  try {
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 250,
    })
      .toString()
      .trim();
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 250,
    })
      .toString()
      .trim();
    if (!branch || !sha) return null;
    return { branch, sha };
  } catch {
    return null;
  }
}

function sessionState(runtime: SdRuntime): JsonObject {
  const session = runtime.session
    ? {
        id: runtime.session.sessionId,
        path: runtime.session.jsonlPath,
        messages: runtime.session.messages().length,
      }
    : null;
  return {
    provider: runtime.provider.id,
    model: runtime.provider.model,
    kind: runtime.provider.kind,
    profile: runtime.profile?.name ?? 'none',
    cwd: runtime.agent.cwd,
    session,
  };
}

function patch(id: string, patchValue: JsonObject): UiEvent {
  return { type: 'ui.component.patch', id, patch: patchValue };
}

function logEvent(level: 'info' | 'warn' | 'error', message: string, source: string): UiEvent {
  return { type: 'ui.log.append', entry: uiLog(level, message, { source }) };
}

function messageToEntry(message: Message): ChatEntry {
  return {
    id: `${message.role}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    role: message.role,
    content: messageContentSummary(message),
    toolCalls: message.tool_calls?.length ?? 0,
    thinking: thinkingText(message.thinking),
  };
}

function thinkingText(blocks: Message['thinking']): string | undefined {
  if (!blocks || blocks.length === 0) return undefined;
  const text = blocks
    .map((block) => block.text)
    .filter((line) => typeof line === 'string' && line.length > 0)
    .join('\n');
  return text.length > 0 ? text : undefined;
}

function trimEntries(entries: ChatEntry[], maxEntries: number): JsonValue[] {
  return entries.slice(-maxEntries).map((entry) => ({ ...entry }));
}

function messageContentSummary(message: Message): string {
  if (typeof message.content === 'string') return message.content;
  const blocks = message.content.map((block) => block.type).join(', ');
  return `[${blocks || 'content'}]`;
}

function upsertTool(tools: ToolEntry[], tool: ToolEntry): ToolEntry[] {
  const index = tools.findIndex((candidate) => candidate.id === tool.id);
  if (index < 0) return [...tools, tool];
  return tools.map((candidate, candidateIndex) =>
    candidateIndex === index ? { ...candidate, ...tool } : candidate,
  );
}

function toolEntryToJson(entry: ToolEntry): JsonObject {
  return {
    id: entry.id,
    name: entry.name,
    status: entry.status,
    ...(entry.content ? { content: entry.content } : {}),
  };
}

function eventEntryToJson(entry: {
  id: string;
  level: string;
  message: string;
  detail?: string;
  source: string;
  timestamp: string;
}): JsonObject {
  return {
    id: entry.id,
    level: entry.level,
    message: entry.message,
    ...(entry.detail ? { detail: entry.detail } : {}),
    source: entry.source,
    timestamp: entry.timestamp,
  };
}

function makeEvent(
  level: 'info' | 'warn' | 'error',
  message: string,
  source: string,
  detail?: string,
): JsonObject {
  return {
    id: makeId('event'),
    level,
    message,
    ...(detail ? { detail } : {}),
    source,
    timestamp: new Date().toISOString(),
  };
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
