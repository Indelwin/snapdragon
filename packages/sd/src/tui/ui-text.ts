export const MAX_TRANSCRIPT_ENTRY_CHARS = 16_000;
export const MAX_TRANSCRIPT_TOOL_CHARS = 4_000;
export const MAX_TRANSCRIPT_THINKING_CHARS = 4_000;
export const MAX_EVENT_DETAIL_CHARS = 64_000;

export function safeUiText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const omitted = value.length - maxChars;
  return `${value.slice(0, Math.max(0, maxChars - 56)).trimEnd()}\n[truncated for TUI display: ${omitted} more char(s)]`;
}
