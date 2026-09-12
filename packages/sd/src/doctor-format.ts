import type { SdDoctorArtifact, SdDoctorFingerprint, SdDoctorReport } from './doctor-types.js';

export function formatSdDoctorReport(report: SdDoctorReport, json = false): string {
  if (json) return `${JSON.stringify(report, null, 2)}\n`;
  return [
    'Snapdragon doctor',
    '',
    `Node: ${report.versions.node} (${report.paths.nodeExecutable})`,
    `CLI: ${value(report.paths.cliEntrypoint)}`,
    `Renderer: ${value(report.versions.renderer)} [${report.versions.rendererMode}] (${value(report.paths.rendererPackage)})`,
    `Build: ${report.build.manifestStatus}`,
    `  commit: ${value(report.build.commit)}`,
    `  source: ${fingerprintLine(report.source)}`,
    `Compiled:`,
    `  Snapdragon runtime packages: ${fingerprintLine(report.compiled.runtime)}`,
    `  sd: ${fingerprintLine(report.compiled.sd)}`,
    `  core: ${fingerprintLine(report.compiled.core)}`,
    `  webtools: ${fingerprintLine(report.compiled.webtools)}`,
    `  renderer: ${fingerprintLine(report.compiled.renderer)}`,
    'WASM:',
    `  core: ${artifactLine(report.wasm.core)}`,
    `  webtools: ${artifactLine(report.wasm.webtools)}`,
    '',
    report.warnings.length === 0 ? 'No warnings.' : 'Warnings:',
    ...report.warnings.map((item) => `  [${item.code}] ${item.message}`),
    '',
  ].join('\n');
}

function fingerprintLine(item: SdDoctorFingerprint): string {
  if (!item.sha256) return 'unavailable';
  return `${item.sha256}${matchSuffix(item.matchesBuild)}`;
}

function artifactLine(item: SdDoctorArtifact): string {
  if (!item.sha256) return `missing (${value(item.path)})`;
  return `${item.sha256} (${item.sizeBytes ?? 0} bytes)${matchSuffix(item.matchesBuild)}`;
}

function matchSuffix(matches: boolean | null): string {
  if (matches === null) return '';
  return matches ? ' [matches build]' : ' [MISMATCH]';
}

function value(raw: string | null): string {
  return raw ?? 'unavailable';
}
