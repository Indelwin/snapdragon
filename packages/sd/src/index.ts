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
  DEFAULT_SD_EXTENSION_ROOT,
  DEFAULT_SD_MEMORY_ROOT,
  DEFAULT_SD_SESSION_ROOT,
  DEFAULT_SD_SESSION_TITLE_MODEL,
  DEFAULT_SD_SESSION_TITLE_PROVIDER,
  defaultSdConfig,
  loadSdConfig,
  loadSdEnvironment,
  type SdAgentConfig,
  type SdConfig,
  type SdExtensionsConfig,
  type SdIsolationConfig,
  type SdMemoryAutoConfig,
  type SdMemoryConfig,
  type SdProviderConfig,
  type SdProviderKind,
  type SdSessionConfig,
  type SdSessionTitleConfig,
  type SdToolsetsConfig,
  withDefaults,
  writeDefaultConfig,
  writeEnvTemplate,
} from './config.js';
export {
  type ExitSummaryOptions,
  formatDuration,
  renderExitSummary,
  writeExitSummary,
} from './exit-summary.js';
export {
  activateSdExtensions,
  type SdExtensionActivationContext,
  type SdExtensionModule,
  type SdExtensionProviderCreateOptions,
  type SdExtensionProviderFactory,
  type SdExtensionProviderRuntime,
  type SdExtensionRuntime,
  type SdExtensionSkillRoot,
} from './extension-runtime.js';
export {
  createSdExtensionStore,
  EXTENSION_MANIFEST_FILES,
  resolveSdExtensionRoots,
  SdExtensionStore,
  type SdExtensionStoreOptions,
} from './extensions.js';
export {
  createSdMemoryStore,
  DEFAULT_SD_MEMORY_FILE,
  type MemoryCaptureResult,
  maybeAutoCaptureMemory,
  requestInputWithMemory,
  resolveSdMemoryPath,
  type SdMemoryProvider,
  SdMemoryStore,
  type SdMemoryStoreOptions,
} from './memory.js';
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
export {
  fallbackTitleFromMessages,
  latestSessionMeta,
  messageText,
  type SdSessionSummary,
  sessionTitle,
  summarizeSession,
} from './session-summary.js';
export {
  DEFAULT_SESSION_TITLE_MODEL,
  type EnsureSessionTitleOptions,
  ensureSessionTitle,
} from './session-title.js';
export type { SdTuiOptions } from './tui/index.js';

export async function runTui(runtime: SdRuntime, options?: SdTuiOptions): Promise<void> {
  const tui = await import('./tui/index.js');
  await tui.runTui(runtime, options);
}

export const sdPackageName = '@snapdragon-ai/sd';
export const sdCommandName = 'sd';
