import { appendRepairedToolItem } from './codex-tool-output.js';
import { trackToolCallState } from './codex-tool-state.js';

export function repairCodexToolOutputs(items: unknown[]): unknown[] {
  const claimed = new Set<string>();
  const provided = new Set<string>();
  for (const item of items) trackToolCallState(item, claimed, provided);

  const out: unknown[] = [];
  for (const item of items) appendRepairedToolItem(item, claimed, provided, out);
  return out;
}
