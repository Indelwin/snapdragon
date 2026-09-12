import type { SdBuildInfo } from './build-info.js';
import type {
  SdDoctorArtifact,
  SdDoctorFingerprint,
  SdDoctorReport,
  SdDoctorWarning,
  SdDoctorWarningTarget,
} from './doctor-types.js';

const rendererModeWarnings: Record<SdDoctorReport['versions']['rendererMode'], SdDoctorWarning[]> =
  {
    production: [],
    development: [
      warning(
        'renderer_development_mode',
        'renderer',
        'Renderer is running in development mode; memory retention may be substantially higher.',
      ),
    ],
  };

export function collectDoctorWarnings(
  manifestStatus: SdDoctorReport['build']['manifestStatus'],
  versions: SdDoctorReport['versions'],
  build: SdBuildInfo | null,
  source: SdDoctorFingerprint,
  compiled: SdDoctorReport['compiled'],
  wasm: SdDoctorReport['wasm'],
): SdDoctorWarning[] {
  const warnings = [
    ...manifestWarnings(manifestStatus),
    ...rendererModeWarnings[versions.rendererMode],
  ];
  addPackageWarnings(warnings, versions, build);
  addSourceWarning(warnings, source);
  for (const target of ['runtime', 'sd', 'core', 'webtools', 'renderer'] as const) {
    addFingerprintWarning(warnings, target, compiled[target]);
  }
  addWasmWarning(warnings, 'core', wasm.core);
  addWasmWarning(warnings, 'webtools', wasm.webtools);
  return warnings;
}

function manifestWarnings(status: SdDoctorReport['build']['manifestStatus']): SdDoctorWarning[] {
  if (status === 'ok') return [];
  return [
    warning(
      status === 'missing' ? 'build_info_missing' : 'build_info_invalid',
      'build-info',
      status === 'missing' ? 'Build manifest is missing.' : 'Build manifest is invalid.',
    ),
  ];
}

function addPackageWarnings(
  warnings: SdDoctorWarning[],
  actual: SdDoctorReport['versions'],
  build: SdBuildInfo | null,
): void {
  for (const target of ['sd', 'core', 'webtools', 'renderer'] as const) {
    if (!actual[target]) {
      warnings.push(warning('package_unresolved', target, `${target} package is unresolved.`));
    } else if (build && actual[target] !== build.packageVersions[target]) {
      warnings.push(
        warning(
          'package_version_mismatch',
          target,
          `${target} package version differs from build.`,
        ),
      );
    }
  }
}

function addSourceWarning(warnings: SdDoctorWarning[], value: SdDoctorFingerprint): void {
  if (value.matchesBuild === false) {
    warnings.push(warning('source_hash_mismatch', 'sd', 'Source fingerprint differs from build.'));
  }
}

function addFingerprintWarning(
  warnings: SdDoctorWarning[],
  target: SdDoctorWarningTarget,
  value: SdDoctorFingerprint,
): void {
  if (!value.sha256) {
    warnings.push(warning('artifact_missing', target, `${target} compiled artifacts are missing.`));
  } else if (value.matchesBuild === false) {
    warnings.push(
      warning('compiled_hash_mismatch', target, `${target} compiled artifacts differ from build.`),
    );
  }
}

function addWasmWarning(
  warnings: SdDoctorWarning[],
  target: 'core' | 'webtools',
  value: SdDoctorArtifact,
): void {
  if (!value.sha256) {
    warnings.push(warning('artifact_missing', target, `${target} WASM artifact is missing.`));
  } else if (value.matchesBuild === false) {
    warnings.push(
      warning('artifact_hash_mismatch', target, `${target} WASM hash differs from build.`),
    );
  }
}

function warning(
  code: SdDoctorWarning['code'],
  target: SdDoctorWarningTarget,
  message: string,
): SdDoctorWarning {
  return { code, target, message };
}
