export const tuiColors = {
  accent: '#ff3b7d',
  accentSoft: '#ff7fa3',
  accentPale: '#ffc6d9',
  foreground: '#e8e8ec',
  dim: '#9a9aa6',
  muted: '#6a6a74',
  border: '#363641',
  borderStrong: '#5b5165',
  borderAccent: '#7a4b63',
  user: '#7fd4ff',
  assistant: '#ff7fa3',
  system: '#9a9aa6',
  tool: '#ffbd5c',
  thinking: '#a995ff',
  ok: '#66d18a',
  warn: '#e8c76a',
  error: '#ff6b6b',
} as const;

export const tuiChars = {
  prompt: '>',
  brand: '*',
  pointer: '>',
  dash: '-',
  bullet: '*',
  cursor: '█',
} as const;

export function trimText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

export function roleColor(role: string): string | undefined {
  if (role === 'user') return tuiColors.user;
  if (role === 'assistant') return tuiColors.assistant;
  if (role === 'tool') return tuiColors.tool;
  if (role === 'error') return tuiColors.error;
  if (role === 'system') return tuiColors.system;
  return undefined;
}
