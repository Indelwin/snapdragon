export function safeArgsPreview(argsJson: string | undefined): string {
  if (!argsJson) return '';
  try {
    return argsPreview(JSON.parse(argsJson) as Record<string, unknown>);
  } catch {
    return argsJson;
  }
}

function argsPreview(parsed: Record<string, unknown>): string {
  return Object.entries(parsed)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(', ');
}
