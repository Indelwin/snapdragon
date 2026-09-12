import { readFile, stat } from 'node:fs/promises';
import { parseSdBuildInfo } from './build-info-parse.js';
import type { SdBuildInfoReadResult } from './build-info-types.js';

export const SD_BUILD_INFO_MAX_BYTES = 64 * 1024;

export async function readSdBuildInfo(path: string): Promise<SdBuildInfoReadResult> {
  try {
    const metadata = await stat(path);
    if (!metadata.isFile() || metadata.size > SD_BUILD_INFO_MAX_BYTES) return invalidBuildInfo();
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    const info = parseSdBuildInfo(parsed);
    return info ? { status: 'ok', info } : invalidBuildInfo();
  } catch (error) {
    return missingFile(error) ? { status: 'missing', info: null } : invalidBuildInfo();
  }
}

function missingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export { parseSdBuildInfo } from './build-info-parse.js';
export {
  SD_BUILD_INFO_SCHEMA_VERSION,
  type SdBuildInfo,
  type SdBuildInfoReadResult,
} from './build-info-types.js';

function invalidBuildInfo(): SdBuildInfoReadResult {
  return { status: 'invalid', info: null };
}
