import type { Toolset } from '../types.js';
import { type FileToolsetOptions, fileToolset } from './file.js';
import { type ShellToolsetOptions, shellToolset } from './shell.js';

export interface CodingToolsetOptions
  extends FileToolsetOptions,
    Omit<ShellToolsetOptions, 'cwd'> {}

export function codingToolsets(options: CodingToolsetOptions): Toolset[] {
  return [fileToolset(options), shellToolset(options)];
}

export function codingToolset(options: CodingToolsetOptions): Toolset {
  const toolsets = codingToolsets(options);
  return {
    name: 'coding',
    title: 'Coding tools',
    description: 'Compatibility grouping for file and shell tools.',
    tools: toolsets.flatMap((toolset) =>
      toolset.tools.map((tool) => ({
        ...tool,
        toolset: 'coding',
      })),
    ),
  };
}
