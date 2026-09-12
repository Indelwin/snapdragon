import { resolveDoctorPackageRoot } from './doctor-package-root.js';
import type { SdDoctorPathOverrides } from './doctor-types.js';

export const SD_DOCTOR_PACKAGE_NAMES = {
  sd: '@snapdragon-ai/sd',
  core: '@snapdragon-ai/core',
  webtools: '@snapdragon-ai/webtools',
  renderer: '@snapdragon-ai/ink',
} as const;

export interface SdDoctorPackageRoots {
  core: string | null;
  webtools: string | null;
  renderer: string | null;
}

export async function resolveDoctorPackageRoots(
  sdPackageRoot: string,
  overrides: SdDoctorPathOverrides,
): Promise<SdDoctorPackageRoots> {
  return {
    core: await resolveDoctorPackageRoot(
      sdPackageRoot,
      '@snapdragon-ai/core',
      SD_DOCTOR_PACKAGE_NAMES.core,
      overrides.packageRoots?.core,
      'core',
    ),
    webtools: await resolveDoctorPackageRoot(
      sdPackageRoot,
      '@snapdragon-ai/webtools',
      SD_DOCTOR_PACKAGE_NAMES.webtools,
      overrides.packageRoots?.webtools,
      'webtools',
    ),
    renderer: await resolveDoctorPackageRoot(
      sdPackageRoot,
      'ink',
      SD_DOCTOR_PACKAGE_NAMES.renderer,
      overrides.packageRoots?.renderer,
      'ink',
    ),
  };
}
