import type { AgentEvent, SnapdragonAgent } from '@snapdragon-ai/agent';
import type { Message, StreamEvent, ToolCall } from '@snapdragon-ai/host';
import { type JsonObject, type UiEvent, UiWorld, uiLog } from '@snapdragon-ai/ui';
import type { PendingAttachment } from '../attachments.js';
import type { SdRuntime } from '../runtime.js';
import type { PromptCompletionState } from './input-completion.js';
import { promptCompletionJson } from './prompt-completion-json.js';
import { ProviderEventBuffer } from './provider-event-buffer.js';
import { startupChatEntries } from './resume-summary-entry.js';
import { runtimeStats } from './runtime-stats.js';
import { resolveSplashImagePath } from './splash-art.js';
import { chatEntries, type EventEntry, eventEntries, toolEntries } from './state-readers.js';
import {
  initialTranscriptEntries,
  messageToEntry,
  runtimeTranscriptEntries,
  sessionMessageCount,
  sessionTranscriptEntries,
} from './transcript-entry.js';
import { messageContentSummary } from './transcript-entry-content.js';
import type { ChatEntry, ToolEntry } from './ui-entry.js';
import { appendStreamingText, chatEntriesToJson, trimChatEntries } from './ui-state-cache.js';
import {
  MAX_EVENT_DETAIL_CHARS,
  MAX_TRANSCRIPT_ENTRY_CHARS,
  MAX_TRANSCRIPT_THINKING_CHARS,
  MAX_TRANSCRIPT_TOOL_CHARS,
  safeUiText,
} from './ui-text.js';

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
  #providerThinkingText = '';
  #providerEvents: ProviderEventBuffer;
  #maxEntries: number;
  #maxLogEntries: number;
  #chatEntries: ChatEntry[] = [];
  #eventEntries: EventEntry[] = [];
  #toolEntries: ToolEntry[] = [];
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
    this.#syncCachedState();
    this.#loadTranscript(initialTranscriptEntries(runtime, this.#maxEntries));
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

  setPromptInput(
    draft: string,
    completion: PromptCompletionState | undefined,
    cursor?: number,
  ): void {
    this.world.apply(
      patch(SD_UI_IDS.prompt, {
        draft,
        cursor: cursor ?? draft.length,
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

  toggleEventPanel = () => this.#togglePanel(SD_UI_IDS.eventLog);
  toggleToolPanel = () => this.#togglePanel(SD_UI_IDS.toolPanel);
  #togglePanel(id: string): void {
    this.world.apply(patch(id, { open: this.world.componentState(id).open === false }));
  }

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
    this.#chatEntries = [];
    this.world.apply(patch(SD_UI_IDS.chat, { entries: [] }));
  }

  loadRuntimeTranscript(): void {
    this.#loadTranscript(runtimeTranscriptEntries(this.runtime.agent.messages, this.#maxEntries));
  }

  loadSessionTranscript(): void {
    this.#loadTranscript(sessionTranscriptEntries(this.runtime.session, this.#maxEntries));
  }

  #loadTranscript(entries: ChatEntry[]): void {
    const trimmed = trimChatEntries(entries, this.#maxEntries);
    this.#chatEntries = trimmed;
    this.world.applyMany([
      patch(SD_UI_IDS.chat, { entries: chatEntriesToJson(trimmed) }),
      patch(SD_UI_IDS.splash, { visible: trimmed.length === 0 }),
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
   * Register the AbortController for Esc cancellation of an in-flight prompt.
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
    this.#providerThinkingText = '';
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
    this.#providerThinkingText = '';
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
    this.#providerThinkingText = '';
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
    if (summary.trim())
      this.#providerTurnText = appendStreamingText('', summary, MAX_TRANSCRIPT_ENTRY_CHARS);
    return [
      this.#replaceChatEntry({
        ...entry,
        content: summary.trim() ? safeUiText(summary, MAX_TRANSCRIPT_ENTRY_CHARS) : entry.content,
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
    const displayContent = safeUiText(content, MAX_TRANSCRIPT_TOOL_CHARS);
    return [
      this.#upsertTool({
        id: call.id,
        name: call.name,
        status: isError ? 'error' : 'done',
        content: displayContent,
      }),
      this.#appendChat({
        id: `tool_${call.id}`,
        role: 'tool',
        content: displayContent,
        isError,
        toolName: call.name,
        toolStatus: isError ? 'error' : 'done',
      }),
      this.#eventEntryEvent(level, `tool finished: ${call.name}`, 'tool', content),
      logEvent(level, `tool finished: ${call.name}`, 'tool'),
    ];
  }

  #appendAssistantText(delta: string): UiEvent {
    this.#providerTurnText = appendStreamingText(
      this.#providerTurnText,
      delta,
      MAX_TRANSCRIPT_ENTRY_CHARS,
    );
    const entry = this.#ensureAssistantEntry();
    entry.content = this.#providerTurnText;
    entry.streaming = true;
    return this.#replaceChatEntry(entry);
  }

  #appendAssistantThinking(delta: string): UiEvent {
    this.#providerThinkingText = appendStreamingText(
      this.#providerThinkingText,
      delta,
      MAX_TRANSCRIPT_THINKING_CHARS,
    );
    const entry = this.#ensureAssistantEntry();
    entry.thinking = this.#providerThinkingText;
    return this.#replaceChatEntry(entry);
  }

  #ensureAssistantEntry(): ChatEntry {
    const current = this.#chatEntries.find((entry) => entry.id === this.#currentAssistantId);
    if (current) return { ...current };
    const entry: ChatEntry = {
      id: this.#nextAssistantId(),
      role: 'assistant',
      content: '',
      streaming: true,
    };
    this.#currentAssistantId = entry.id;
    this.#chatEntries = trimChatEntries([...this.#chatEntries, entry], this.#maxEntries);
    return { ...entry };
  }

  #nextAssistantId(): string {
    this.#assistantSequence += 1;
    return `assistant_${this.#activeRunId ?? Date.now()}_${this.#assistantSequence}`;
  }

  #replaceChatEntry(entry: ChatEntry): UiEvent {
    const entries =
      entry.role === 'assistant' && this.#activeRunId
        ? [...this.#chatEntries.filter((candidate) => candidate.id !== entry.id), entry]
        : this.#chatEntries.map((candidate) => (candidate.id === entry.id ? entry : candidate));
    this.#chatEntries = trimChatEntries(entries, this.#maxEntries);
    return patch(SD_UI_IDS.chat, { entries: chatEntriesToJson(this.#chatEntries) });
  }

  #appendChat(entry: ChatEntry): UiEvent {
    this.#chatEntries = trimChatEntries([...this.#chatEntries, entry], this.#maxEntries);
    return patch(SD_UI_IDS.chat, { entries: chatEntriesToJson(this.#chatEntries) });
  }

  #upsertTool(tool: ToolEntry): UiEvent {
    this.#toolEntries = upsertTool(this.#toolEntries, tool).slice(-20);
    return patch(SD_UI_IDS.toolPanel, { tools: this.#toolEntries.map(toolEntryToJson) });
  }

  #eventEntryEvent(
    level: 'info' | 'warn' | 'error',
    message: string,
    source: string,
    detail?: string,
  ): UiEvent {
    const event = makeEvent(
      level,
      message,
      source,
      detail ? safeUiText(detail, MAX_EVENT_DETAIL_CHARS) : detail,
    );
    this.#eventEntries = [...this.#eventEntries, event].slice(-this.#maxLogEntries);
    return patch(SD_UI_IDS.eventLog, {
      entries: this.#eventEntries.map(eventEntryToJson),
    });
  }

  #markChatEntryStreaming(id: string, streaming: boolean): UiEvent {
    this.#chatEntries = trimChatEntries(this.#chatEntries, this.#maxEntries).map((entry) =>
      entry.id === id ? { ...entry, streaming } : entry,
    );
    return patch(SD_UI_IDS.chat, { entries: chatEntriesToJson(this.#chatEntries) });
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
          messages: sessionMessageCount(this.runtime),
        },
      }),
    ];
  }

  #flushProviderEvents(events: readonly StreamEvent[]): void {
    this.world.applyMany(this.#bufferedProviderEventsToUiEvents(events));
  }

  #bufferedProviderEventsToUiEvents(events: readonly StreamEvent[]): UiEvent[] {
    const uiEvents: UiEvent[] = [];
    let pendingText = '';
    let pendingThinking = '';
    let pendingArgs = false;
    const flushPendingText = () => {
      if (!pendingText) return;
      uiEvents.push(this.#appendAssistantText(pendingText), this.#phasePatch('streaming'));
      pendingText = '';
    };
    const flushPendingThinking = () => {
      if (!pendingThinking) return;
      uiEvents.push(this.#appendAssistantThinking(pendingThinking), this.#phasePatch('thinking'));
      pendingThinking = '';
    };
    for (const event of events) {
      if (event.kind === 'text') {
        flushPendingThinking();
        pendingText += event.delta;
      } else if (event.kind === 'thinking') {
        flushPendingText();
        pendingThinking += event.delta;
      } else if (event.kind === 'input_json_delta') {
        flushPendingText();
        flushPendingThinking();
        pendingArgs = true;
      } else {
        flushPendingText();
        flushPendingThinking();
        uiEvents.push(...this.#providerEventToUiEvents(event));
      }
    }
    flushPendingText();
    flushPendingThinking();
    if (pendingArgs) uiEvents.push(patch(SD_UI_IDS.runStatus, { toolArgsStreaming: true }));
    return uiEvents;
  }

  #syncCachedState(): void {
    this.#chatEntries = chatEntries(this.world.componentState(SD_UI_IDS.chat));
    this.#eventEntries = eventEntries(this.world.componentState(SD_UI_IDS.eventLog));
    this.#toolEntries = toolEntries(this.world.componentState(SD_UI_IDS.toolPanel));
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
    register(SD_UI_IDS.chat, 'chat.transcript', 'main', 0, {
      entries: startupChatEntries(runtime),
    }),
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
    register(SD_UI_IDS.keybinds, 'keybind.bar', 'footer', 0, { binds: FOOTER_KEYBINDS }),
    ...runtime.warnings.map((warning) => logEvent('warn', warning, 'session')),
    { type: 'ui.focus.set', id: SD_UI_IDS.prompt },
  ];
}

const FOOTER_KEYBINDS = [
  { keys: 'enter', label: 'send' },
  { keys: 'shift-enter', label: 'newline' },
  { keys: 'up/down', label: 'select/history' },
  { keys: 'pgup/dn', label: 'scroll' },
  { keys: 'ctrl-p', label: 'palette' },
  { keys: 'ctrl-e/t', label: 'events/tools' },
  { keys: 'ctrl-c', label: 'quit' },
];

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

function sessionState(runtime: SdRuntime): JsonObject {
  const session = runtime.session
    ? {
        id: runtime.session.sessionId,
        path: runtime.session.jsonlPath,
        messages: sessionMessageCount(runtime),
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
): EventEntry {
  return {
    id: makeId('event'),
    level,
    message,
    detail,
    source,
    timestamp: new Date().toISOString(),
  };
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
