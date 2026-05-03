import { runHandleCommandFlow } from './slash-line-flow.js';
import { isRuntimeTransitionCommand, togglePanel } from './slash-line-guards.js';
import { tryOpenSelection } from './slash-line-selection.js';
import type { RunSlashLineArgs } from './slash-line-types.js';

export type { RunSlashLineArgs } from './slash-line-types.js';

export async function runSlashLine(args: RunSlashLineArgs): Promise<void> {
  if (args.line === '/events' || args.line === '/tools-panel') {
    togglePanel(args.line, args.controller);
    return;
  }
  if (args.line === '/palette') {
    args.setPalette({ open: true, query: '', selectedIndex: 0 });
    return;
  }
  if (args.line === '/quit' || args.line === '/exit') {
    args.exit();
    return;
  }
  if (args.controller.isRunning && isRuntimeTransitionCommand(args.line)) {
    args.controller.appendCommandOutput('A run is already active.', 'error');
    return;
  }
  if (await tryOpenSelection(args)) return;
  await runHandleCommandFlow(args);
}
