import type { AgentEvent, SnapdragonAgent } from '@snapdragon-ai/agent';
import type { Message, StreamEvent, ToolCall } from '@snapdragon-ai/host';
import { type JsonObject, type JsonValue, type UiEvent, UiWorld, uiLog } from '@snapdragon-ai/ui';
import type { PendingAttachment } from '../attachments.js';
import type { SdRuntime } from '../runtime.js';
import type { PromptCompletionState } from './input-completion.js';
import { chatEntries, eventEntries, toolEntries } from './state-readers.js';

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

interface ChatEntry {
  id: string;
  role: string;
  content: string;
  streaming?: boolean;
  thinking?: string;
  toolCalls?: number;
  isError?: boolean;
}

interface ToolEntry {
  id: string;
  name: string;
  status: string;
  content?: string;
}

export class SdUiController {
  readonly world: UiWorld;
  readonly runtime: SdRuntime;
  #activeRunId: string | undefined;
  #currentAssistantId: string | undefined;
  #assistantSequence = 0;
  #maxEntries: number;
  #maxLogEntries: number;
  #boundAgent: SnapdragonAgent | undefined;
  #unsubscribeAgent: (() => void) | undefined;

  constructor(runtime: SdRuntime, world = new UiWorld(), options: SdUiControllerOptions = {}) {
    this.runtime = runtime;
    this.world = world;
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
    this.#unsubscribeAgent?.();
    this.#unsubscribeAgent = undefined;
    this.#boundAgent = undefined;
  }

  acceptAgentEvent(event: AgentEvent): void {
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

  setPromptCompletion(completion: PromptCompletionState | undefined): void {
    this.world.apply(
      patch(SD_UI_IDS.prompt, {
        completion: completion
          ? {
              mode: completion.mode,
              query: completion.query,
              selectedIndex: completion.selectedIndex,
              suggestions: completion.suggestions.map((suggestion) => ({ ...suggestion })),
            }
          : null,
      }),
    );
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

  refreshRuntimeStatus(): void {
    this.world.applyMany([
      patch(SD_UI_IDS.sessionStatus, sessionState(this.runtime)),
      patch(SD_UI_IDS.splash, {
        provider: this.runtime.provider.id,
        model: this.runtime.provider.model,
        profile: this.runtime.profile?.name ?? 'none',
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
    this.world.applyMany([
      patch(SD_UI_IDS.runStatus, { status: 'error', error: message }),
      patch(SD_UI_IDS.prompt, { running: false }),
      this.#eventEntryEvent('error', message, 'agent'),
      logEvent('error', message, 'agent'),
    ]);
  }

  #runStart(runId: string): UiEvent[] {
    this.#activeRunId = runId;
    this.#currentAssistantId = undefined;
    this.#assistantSequence = 0;
    return [
      patch(SD_UI_IDS.runStatus, { status: 'running', runId, error: null }),
      patch(SD_UI_IDS.prompt, { running: true }),
      patch(SD_UI_IDS.splash, { visible: false }),
      this.#eventEntryEvent('info', `run started: ${runId}`, 'agent'),
      logEvent('info', `run started: ${runId}`, 'agent'),
    ];
  }

  #runEnd(runId: string): UiEvent[] {
    this.#activeRunId = undefined;
    this.#currentAssistantId = undefined;
    return [
      patch(SD_UI_IDS.runStatus, { status: 'done', runId, error: null }),
      patch(SD_UI_IDS.prompt, { running: false }),
      this.#eventEntryEvent('info', `run finished: ${runId}`, 'agent'),
      logEvent('info', `run finished: ${runId}`, 'agent'),
    ];
  }

  #providerEventToUiEvents(event: StreamEvent): UiEvent[] {
    if (event.kind === 'text') return [this.#appendAssistantText(event.delta)];
    if (event.kind === 'thinking') return [this.#appendAssistantThinking(event.delta)];
    if (event.kind === 'tool_call_start') return this.#providerToolStartEvents(event);
    if (event.kind === 'usage') return this.#usageEvents(event);
    if (event.kind === 'started') return this.#providerStartedEvents(event);
    if (event.kind === 'max_tokens_reached') {
      return this.#logEvents('warn', 'provider reached max_tokens', 'provider');
    }
    if (event.kind === 'error') return this.#logEvents('error', event.message, 'provider');
    if (event.kind === 'input_json_delta') {
      return [patch(SD_UI_IDS.runStatus, { toolArgsStreaming: true })];
    }
    return [];
  }

  #providerStartedEvents(event: Extract<StreamEvent, { kind: 'started' }>): UiEvent[] {
    return [
      patch(SD_UI_IDS.runStatus, { provider: event.provider, model: event.model ?? null }),
      this.#eventEntryEvent('info', `stream started: ${event.provider}`, 'provider'),
    ];
  }

  #providerToolStartEvents(event: Extract<StreamEvent, { kind: 'tool_call_start' }>): UiEvent[] {
    return [
      this.#upsertTool({ id: event.id, name: event.name, status: 'running' }),
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
    if (message.role === 'assistant' && this.#currentAssistantId) {
      return this.#assistantFinalEvents(message).concat(sessionPatch);
    }
    return [
      this.#appendChat(messageToEntry(message)),
      patch(SD_UI_IDS.splash, { visible: false }),
    ].concat(sessionPatch);
  }

  #assistantFinalEvents(message: Message): UiEvent[] {
    const entries = chatEntries(this.world.componentState(SD_UI_IDS.chat)).map((entry) =>
      entry.id === this.#currentAssistantId
        ? {
            ...entry,
            content: messageContentSummary(message),
            streaming: false,
            toolCalls: message.tool_calls?.length ?? 0,
          }
        : entry,
    );
    this.#currentAssistantId = undefined;
    return [patch(SD_UI_IDS.chat, { entries: trimEntries(entries, this.#maxEntries) })];
  }

  #toolStartEvents(call: ToolCall): UiEvent[] {
    return [
      this.#upsertTool({ id: call.id, name: call.name, status: 'running' }),
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
      this.#eventEntryEvent(level, `tool finished: ${call.name}`, 'tool'),
      logEvent(level, `tool finished: ${call.name}`, 'tool'),
    ];
  }

  #appendAssistantText(delta: string): UiEvent {
    const entry = this.#ensureAssistantEntry();
    entry.content += delta;
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
    const entries = chatEntries(this.world.componentState(SD_UI_IDS.chat)).map((candidate) =>
      candidate.id === entry.id ? entry : candidate,
    );
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

  #eventEntryEvent(level: 'info' | 'warn' | 'error', message: string, source: string): UiEvent {
    const entries = eventEntries(this.world.componentState(SD_UI_IDS.eventLog)).map(
      eventEntryToJson,
    );
    return patch(SD_UI_IDS.eventLog, {
      entries: [...entries, makeEvent(level, message, source)].slice(-this.#maxLogEntries),
    });
  }

  #logEvents(level: 'info' | 'warn' | 'error', message: string, source: string): UiEvent[] {
    return [this.#eventEntryEvent(level, message, source), logEvent(level, message, source)];
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
  };
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
  source: string;
  timestamp: string;
}): JsonObject {
  return {
    id: entry.id,
    level: entry.level,
    message: entry.message,
    source: entry.source,
    timestamp: entry.timestamp,
  };
}

function makeEvent(level: 'info' | 'warn' | 'error', message: string, source: string): JsonObject {
  return {
    id: makeId('event'),
    level,
    message,
    source,
    timestamp: new Date().toISOString(),
  };
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
