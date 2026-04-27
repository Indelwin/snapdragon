import type { SdRuntime } from './runtime.js';
import type { SdTuiOptions } from './tui/index.js';

export { parseArgs, type SdCliArgs, type SdCliMode } from './args.js';
export {
  attachmentFromReference,
  contentWithAttachments,
  mediaTypeForPath,
  type PendingAttachment,
} from './attachments.js';
export { helpText, isDirectEntrypoint, main } from './cli.js';
export {
  DEFAULT_SD_CONFIG_PATH,
  DEFAULT_SD_ENV_PATH,
  DEFAULT_SD_SESSION_ROOT,
  defaultSdConfig,
  loadSdConfig,
  loadSdEnvironment,
  type SdAgentConfig,
  type SdConfig,
  type SdProviderConfig,
  type SdProviderKind,
  type SdSessionConfig,
  type SdToolsetsConfig,
  withDefaults,
  writeDefaultConfig,
  writeEnvTemplate,
} from './config.js';
export {
  ACTIVE_PROFILE_FILE,
  DEFAULT_SD_PROFILE_ROOT,
  type SdProfileConfig,
  type SdProfileInfo,
  SdProfileStore,
  type SdProfileStoreOptions,
} from './profile.js';
export {
  type ResolvedSdRuntimeConfig,
  resolveSdRuntimeConfig,
  type SdRuntimeCliOverrides,
} from './profile-runtime.js';
export { makeSdProvider, type SdProviderRuntime } from './provider.js';
export {
  defaultIo,
  handleCommand,
  runInteractive,
  runInteractive as runRepl,
  runOneShot,
  runOneShot as runPrompt,
  type SdIo,
} from './repl.js';
export {
  createSdRuntime,
  normalizeRuntimeOptions,
  type SdRuntime,
  type SdRuntimeOptions,
} from './runtime.js';
export {
  currentProfileName,
  deleteRuntimeSession,
  newRuntimeSession,
  rebuildSdRuntime,
  resumeRuntimeSession,
  type SdRuntimeRebuildOptions,
  switchRuntimeProfile,
} from './runtime-transitions.js';
export type { SdTuiOptions } from './tui/index.js';

export async function runTui(runtime: SdRuntime, options?: SdTuiOptions): Promise<void> {
  const tui = await import('./tui/index.js');
  await tui.runTui(runtime, options);
}

export const sdPackageName = '@snapdragon-ai/sd';
export const sdCommandName = 'sd';
