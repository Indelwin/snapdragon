export function defaultSystemPrompt(): string {
  return 'You are a concise, practical assistant. Use tools when they materially help.';
}

export function defaultCodingSystemPrompt(): string {
  return [
    'You are a coding agent running inside a local workspace.',
    'Use the coding tools for file and shell work.',
    'Use repl_eval when programmatic inspection or repeated tool invocation would be more efficient.',
    'Keep changes scoped to the user request.',
  ].join('\n');
}
