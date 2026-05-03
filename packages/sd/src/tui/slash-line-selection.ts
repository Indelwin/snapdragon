import { type PromptSelection, selectionForLine } from './input-selection.js';
import { errorMessage } from './slash-line-io.js';
import type { RunSlashLineArgs } from './slash-line-types.js';

export async function tryOpenSelection(args: RunSlashLineArgs): Promise<boolean> {
  let selection: PromptSelection | undefined;
  try {
    selection = await selectionForLine(args.line, args.runtime);
  } catch (error) {
    args.controller.appendCommandOutput(errorMessage(error), 'error');
    return true;
  }
  if (!selection || !args.openSelection) return false;
  args.openSelection(selection.draft, { completion: selection.completion });
  if (selection.warning) args.controller.appendCommandOutput(selection.warning, 'error');
  return true;
}
