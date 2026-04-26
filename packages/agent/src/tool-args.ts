export function parseToolArgs(argsJson: string): unknown {
  if (argsJson.trim().length === 0) return {};
  try {
    return JSON.parse(argsJson) as unknown;
  } catch {
    return { raw: argsJson };
  }
}
