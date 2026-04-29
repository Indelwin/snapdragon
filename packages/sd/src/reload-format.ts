import type { ReloadReport, ReloadStepReport } from './reload-types.js';

/**
 * Format a `ReloadReport` for display in the slash-command output. Always
 * ends with the "restart required for…" disclosure so users know what
 * /reload can and cannot pick up — Phase-0 only reloads things discovered
 * from disk; statically-imported core packages still need a restart.
 */
export function formatReloadReport(report: ReloadReport): string {
  const lines: string[] = ['Reload complete:'];
  if (report.pulled) lines.push(stepLine('pull', report.pulled));
  if (report.built) lines.push(stepLine('build', report.built));
  lines.push(...summaryLines(report), '', `Reloaded in ${report.durationMs}ms.`);
  lines.push('', ...restartRequiredLines());
  return lines.join('\n');
}

function summaryLines(report: ReloadReport): string[] {
  const errSuffix = report.extensionErrors > 0 ? ` (${report.extensionErrors} errors)` : '';
  return [
    `  extensions: ${report.extensions}${errSuffix}`,
    `  skills:     ${report.skills}`,
    `  profiles:   ${report.profiles}`,
    `  services:   ${report.services}`,
    `  provider:   ${report.provider}`,
  ];
}

function restartRequiredLines(): string[] {
  return [
    'Restart required for changes to:',
    '  • @snapdragon-ai/host  (provider streaming, message format)',
    '  • @snapdragon-ai/agent (run loop, tool dispatch)',
    '  • @snapdragon-ai/tools (built-in tool implementations)',
    '  • @snapdragon-ai/sd    (TUI renderers, keymaps, REPL plumbing)',
  ];
}

function stepLine(label: string, step: ReloadStepReport): string {
  const status = step.ok ? 'ok' : 'failed';
  const detail = step.tail ? ` — ${step.tail.replace(/\n/g, ' / ')}` : '';
  return `  ${label.padEnd(10)}${status}${detail}`;
}
