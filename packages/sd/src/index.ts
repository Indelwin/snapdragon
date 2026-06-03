import type { SdRuntime } from './runtime.js';
import type { SdTuiOptions } from './tui/index.js';

export { parseArgs, type SdCliArgs, type SdCliMode } from './args.js';
export {
  attachmentFromReference,
  contentWithAttachments,
  mediaTypeForPath,
  type PendingAttachment,
} from './attachments.js';
export {
  type SdBackgroundContext,
  type SdBackgroundService,
  type SdBackgroundServiceResult,
  type SdBackgroundServiceStatus,
  type SdBackgroundServicesHandle,
  type SdBackgroundServicesOptions,
  startSdBackgroundServices,
} from './background.js';
export { helpText, isDirectEntrypoint, main } from './cli.js';
export {
  type ClipboardImage,
  type ClipboardOptions,
  type ClipboardRunner,
  type ClipboardRunResult,
  type ClipboardText,
  clipboardSupported,
  type PasteImageOptions,
  parseAppleScriptHex,
  pasteImageAttachment,
  readClipboardImage,
  readClipboardText,
  unsupportedPlatformMessage,
} from './clipboard.js';
export type { SdSkillBuilderConfig } from './config.js';
export {
  DEFAULT_SD_CONFIG_PATH,
  DEFAULT_SD_DAEMON_ROOT,
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
  type SdAgentContextConfig,
  type SdConfig,
  type SdExtensionsConfig,
  type SdGatewayConfig,
  type SdGatewayRuntime,
  type SdGatewayServiceConfig,
  type SdMemoryAutoConfig,
  type SdMemoryConfig,
  type SdMemoryWorkerConfig,
  type SdProviderConfig,
  type SdProviderKind,
  type SdSessionConfig,
  type SdSessionTitleConfig,
  type SdToolsetsConfig,
  withDefaults,
  writeDefaultConfig,
  writeEnvTemplate,
} from './config.js';
export type {
  SdBackgroundConfig,
  SdBackgroundMode,
  SdDaemonConfig,
  SdGatewayChannelEventsConfig,
  SdGatewayChannelsConfig,
  SdIsolationConfig,
} from './config-runtime-types.js';
export {
  DEFAULT_SD_SESSION_INDEX_PATH,
  type SdSessionIndexConfig,
} from './config-session-index.js';
export {
  runSdDaemon,
  runSdDaemonOnce,
  sdDaemonStatus,
  startSdDaemon,
  stopSdDaemon,
} from './daemon.js';
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
  channelRootForTarget,
  createSdGatewayChannelStore,
  gatewayChannelRootForConfig,
  normalizeGatewayChannelTarget,
  type SdGatewayChannelDescriptor,
  type SdGatewayChannelEnsureOptions,
  type SdGatewayChannelLogEntry,
  type SdGatewayChannelStore,
  type SdGatewayChannelTarget,
} from './gateway-channels.js';
export { runGatewayCommand } from './gateway-command.js';
export type { GatewayCommandOptions } from './gateway-command-options.js';
export {
  channelEventService,
  runSdGatewayChannelEventsOnce,
  type SdGatewayEventScanResult,
} from './gateway-event-service.js';
export {
  claimDueGatewayChannelEvents,
  completeGatewayChannelEvent,
  writeSdGatewayChannelEvent,
} from './gateway-events-files.js';
export {
  eventPath,
  gatewayEventRootForConfig,
  isGatewayChannelEventDue,
  normalizeGatewayChannelEvent,
  type SdGatewayChannelEvent,
  type SdGatewayChannelEventClaim,
  type SdGatewayChannelEventInput,
  type SdGatewayChannelEventResult,
  type SdGatewayChannelEventState,
  type SdGatewayChannelEventType,
  type SdGatewayChannelEventWriteResult,
} from './gateway-events-types.js';
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
  memoryWorkerService,
  runSdMemoryWorkerOnce,
  type SdMemoryWorkerHandle,
  type SdMemoryWorkerOptions,
  type SdMemoryWorkerScanResult,
  startSdMemoryWorker,
} from './memory-worker.js';
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
  replHeader,
  runInteractive,
  runInteractive as runRepl,
  runOneShot,
  runOneShot as runPrompt,
  type SdIo,
} from './repl.js';
export {
  createSdRuntime,
  defaultSdBackgroundServices,
  normalizeRuntimeOptions,
  type SdRuntime,
  type SdRuntimeOptions,
  stopSdRuntime,
} from './runtime.js';
export {
  deleteRuntimeSession,
  newRuntimeSession,
  resumeRuntimeSession,
} from './runtime-session-transitions.js';
export {
  currentProfileName,
  rebuildSdRuntime,
  type SdRuntimeRebuildOptions,
  switchRuntimeProfile,
} from './runtime-transitions.js';
export { searchMessagesToolset } from './search-messages-tool.js';
export {
  defaultSessionIndexRootFor,
  formatSessionSearchHit,
  formatSessionSearchHits,
  openSdSessionIndex,
  resolveSdSessionIndexPath,
  SdSessionIndex,
  type SessionSearchHit,
  type SessionSearchOptions,
  sessionIndexEnabled,
  sessionIndexService,
} from './session-index.js';
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
export {
  runSdSkillBuilderOnce,
  type SdSkillBuilderScanResult,
  type SdSkillPattern,
  skillBuilderService,
} from './skill-builder.js';
export type { SdTuiOptions } from './tui/index.js';

export async function runTui(runtime: SdRuntime, options?: SdTuiOptions): Promise<void> {
  const tui = await import('./tui/index.js');
  await tui.runTui(runtime, options);
}

export const sdPackageName = '@snapdragon-ai/sd';
export const sdCommandName = 'sd';
