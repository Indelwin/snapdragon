import type { SdBackgroundServiceStatus } from './background.js';
import type { SdStatusReport } from './status.js';

/**
 * Render a `SdStatusReport` as a plain-text dashboard suitable for the
 * slash-command output area. Ordering is intentional — most-asked-first
 * (provider, session, services, memory).
 */
export function formatSdStatus(report: SdStatusReport): string {
  return [
    sectionAgent(report),
    sectionLocation(report),
    sectionServices(report.services, report.generatedAt),
    sectionMemory(report.memory),
    sectionSkills(report.skills),
    sectionProfiles(report),
    sectionExtensions(report.extensions),
    sectionTools(report.tools),
  ]
    .filter((line) => line.length > 0)
    .join('\n');
}

function sectionAgent(report: SdStatusReport): string {
  const r = report.agent.reasoning;
  const reasoning = r.enabled ? `reasoning=${r.effort ?? 'medium'}` : 'reasoning=off';
  const ctx = report.agent.contextTokens ? `ctx=${formatTokens(report.agent.contextTokens)}` : '';
  const out = report.agent.outputTokens ? `out=${formatTokens(report.agent.outputTokens)}` : '';
  const headline = [
    `${report.agent.provider}/${report.agent.model}`,
    reasoning,
    ctx,
    out,
    `${report.agent.messages} msg`,
  ]
    .filter(Boolean)
    .join('  ');
  return `agent      ${headline}`;
}

function sectionLocation(report: SdStatusReport): string {
  const lines: string[] = [];
  lines.push(
    report.session
      ? `session    ${report.session.id}  (${report.session.messages} msg)`
      : 'session    (none)',
  );
  if (report.profile) lines.push(`profile    ${report.profile}`);
  lines.push(`cwd        ${report.cwd}`);
  if (report.git?.branch || report.git?.sha) {
    const dirty = report.git.dirty ? ' *' : '';
    lines.push(`git        ${report.git.branch ?? '?'} @ ${report.git.sha ?? '?'}${dirty}`);
  }
  return lines.join('\n');
}

function sectionServices(services: SdBackgroundServiceStatus[], generatedAt: string): string {
  if (services.length === 0) return '';
  const now = Date.parse(generatedAt);
  const lines = ['', 'services'];
  for (const s of services) lines.push(formatServiceLine(s, now));
  return lines.join('\n');
}

function formatServiceLine(s: SdBackgroundServiceStatus, now: number): string {
  const flag = s.enabled ? 'on ' : 'off';
  const last = s.last_run_at ? `last=${formatRelative(now - s.last_run_at)}` : 'last=never';
  const errs = s.errors > 0 ? `  errors=${s.errors}` : '';
  const summary = s.last_summary ? `  "${s.last_summary}"` : '';
  return `  ${s.name.padEnd(16)} ${flag}  runs=${s.runs}  ${last}${errs}${summary}`;
}

function sectionMemory(memory: SdStatusReport['memory']): string {
  if (!memory.enabled) return 'memory     disabled';
  const tentative = memory.tentative > 0 ? `  (${memory.tentative} tentative)` : '';
  return `memory     ${memory.total} entries${tentative}`;
}

function sectionSkills(skills: SdStatusReport['skills']): string {
  if (skills.total === 0) return 'skills     0';
  const breakdown = Object.entries(skills.bySource)
    .map(([source, count]) => `${count} ${source}`)
    .join(', ');
  return `skills     ${skills.total}  (${breakdown})`;
}

function sectionProfiles(report: SdStatusReport): string {
  if (report.profiles.total === 0) return '';
  return `profiles   ${report.profiles.total}  (${report.profiles.names.join(', ')})`;
}

function sectionExtensions(extensions: SdStatusReport['extensions']): string {
  if (extensions.total === 0) return '';
  const errs = extensions.errors > 0 ? `  ${extensions.errors} errors` : '';
  return `extensions ${extensions.total}  (${extensions.ids.join(', ')})${errs}`;
}

function sectionTools(tools: SdStatusReport['tools']): string {
  return `tools      ${tools.total}`;
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

function formatRelative(deltaMs: number): string {
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return 'just now';
  const seconds = Math.round(deltaMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
