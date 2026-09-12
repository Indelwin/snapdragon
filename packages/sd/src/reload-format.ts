import type { ReloadReport, ReloadStepReport } from './reload-types.js';

export function formatReloadReport(report: ReloadReport): string {
  const failed = report.pulled?.ok === false || report.built?.ok === false;
  const heading = failed
    ? 'Reload incomplete:'
    : report.restart
      ? 'Reload prepared:'
      : 'Reload complete:';
  const lines: string[] = [heading];
  if (report.pulled) lines.push(stepLine('pull', report.pulled));
  if (report.built) lines.push(stepLine('build', report.built));
  lines.push(...summaryLines(report), '', `Reloaded in ${report.durationMs}ms.`);
  if (report.restart) lines.push('', 'Restart requested after the current run drains.');
  else if (failed) lines.push('', 'The current runtime remains active.');
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

function stepLine(label: string, step: ReloadStepReport): string {
  const status = step.ok ? 'ok' : 'failed';
  const detail = step.tail ? ` - ${step.tail.replace(/\n/g, ' / ')}` : '';
  return `  ${label.padEnd(10)}${status}${detail}`;
}
