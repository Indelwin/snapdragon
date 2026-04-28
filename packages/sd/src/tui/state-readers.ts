import type { JsonObject, JsonValue } from '@snapdragon-ai/ui';

export interface ChatEntry {
  id: string;
  role: string;
  content: string;
  thinking?: string;
  streaming?: boolean;
  toolCalls?: number;
  isError?: boolean;
  toolName: string | undefined;
  toolStatus: string | undefined;
}

export interface ToolEntry {
  id: string;
  name: string;
  status: string;
  content?: string;
}

export interface EventEntry {
  id: string;
  level: string;
  message: string;
  detail: string | undefined;
  source: string;
  timestamp: string;
}

export interface CommandEntry {
  name: string;
  description: string;
  argHint?: string;
}

export interface KeybindEntry {
  keys: string;
  label: string;
}

export interface PromptSuggestionEntry {
  label: string;
  description: string;
  insertText: string;
  kind: string;
}

export interface PromptCompletionEntry {
  mode: string;
  query: string;
  selectedIndex: number;
  suggestions: PromptSuggestionEntry[];
}

export function chatEntries(state: JsonObject): ChatEntry[] {
  return arrayOfObjects(state.entries).map((entry) => ({
    id: stringValue(entry.id),
    role: stringValue(entry.role),
    content: stringValue(entry.content),
    thinking: optionalStringValue(entry.thinking),
    streaming: entry.streaming === true,
    toolCalls: numberValue(entry.toolCalls),
    isError: entry.isError === true,
    toolName: optionalStringValue(entry.toolName),
    toolStatus: optionalStringValue(entry.toolStatus),
  }));
}

export function toolEntries(state: JsonObject): ToolEntry[] {
  return arrayOfObjects(state.tools).map((entry) => ({
    id: stringValue(entry.id),
    name: stringValue(entry.name),
    status: stringValue(entry.status) || 'running',
    content: optionalStringValue(entry.content),
  }));
}

export function eventEntries(state: JsonObject): EventEntry[] {
  return arrayOfObjects(state.entries).map((entry) => ({
    id: stringValue(entry.id),
    level: stringValue(entry.level),
    message: stringValue(entry.message),
    detail: optionalStringValue(entry.detail),
    source: stringValue(entry.source),
    timestamp: stringValue(entry.timestamp),
  }));
}

export function commandEntries(state: JsonObject): CommandEntry[] {
  return arrayOfObjects(state.commands).map((entry) => ({
    name: stringValue(entry.name),
    description: stringValue(entry.description),
    argHint: optionalStringValue(entry.argHint),
  }));
}

export function keybindEntries(state: JsonObject): KeybindEntry[] {
  return arrayOfObjects(state.binds).map((entry) => ({
    keys: stringValue(entry.keys),
    label: stringValue(entry.label),
  }));
}

export function promptCompletion(state: JsonObject): PromptCompletionEntry | undefined {
  const completion = objectValue(state.completion);
  if (!completion) return undefined;
  return {
    mode: stringValue(completion.mode),
    query: stringValue(completion.query),
    selectedIndex: numberValue(completion.selectedIndex) ?? 0,
    suggestions: arrayOfObjects(completion.suggestions).map((entry) => ({
      label: stringValue(entry.label),
      description: stringValue(entry.description),
      insertText: stringValue(entry.insertText),
      kind: stringValue(entry.kind),
    })),
  };
}

export function arrayOfStrings(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

export function objectValue(value: JsonValue | undefined): JsonObject | undefined {
  return isJsonObject(value) ? value : undefined;
}

export function stringValue(value: JsonValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

export function optionalStringValue(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function numberValue(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function arrayOfObjects(value: JsonValue | undefined): JsonObject[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isJsonObject);
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
