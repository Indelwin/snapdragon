export const sdPackageName = '@snapdragon-ai/sd';
export const sdCommandName = 'sd';

export function createSdPlaceholderMessage(): string {
  return [
    `${sdCommandName} is reserved for the batteries-included Snapdragon code agent.`,
    'The full agent is not implemented in this package yet.',
    'Use the snapdragon REPL binary from @snapdragon-ai/repl for the current minimal coding agent.',
  ].join('\n');
}
