import type { JsonObject } from '@snapdragon-ai/ui';

export interface SdTuiCommand {
  name: string;
  description: string;
  argHint?: string;
  run: (arg?: string) => void | Promise<void>;
}

export interface SdTuiCommandDescriptor {
  name: string;
  description: string;
  argHint?: string;
}

export function commandDescriptors(commands: readonly SdTuiCommand[]): JsonObject[] {
  return commands.map(({ name, description, argHint }) => ({
    name,
    description,
    ...(argHint ? { argHint } : {}),
  }));
}

export function filterCommands(commands: readonly SdTuiCommand[], query: string): SdTuiCommand[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [...commands];
  return commands.filter((command) => {
    const haystack = `${command.name} ${command.description}`.toLowerCase();
    return haystack.includes(trimmed);
  });
}

export function matchCommandLine(
  commands: readonly SdTuiCommand[],
  line: string,
): { command: SdTuiCommand; arg: string | undefined } | undefined {
  const trimmed = line.trim();
  const matches = [...commands].sort((a, b) => b.name.length - a.name.length);
  const command = matches.find(
    (candidate) => trimmed === candidate.name || trimmed.startsWith(`${candidate.name} `),
  );
  if (!command) return undefined;
  const arg = trimmed.slice(command.name.length).trim() || undefined;
  return { command, arg };
}
