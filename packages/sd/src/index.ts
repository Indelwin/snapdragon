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
export { makeSdProvider, type SdProviderRuntime } from './provider.js';
export { defaultIo, handleCommand, runInteractive, runOneShot, type SdIo } from './repl.js';
export { createSdRuntime, type SdRuntime } from './runtime.js';

export const sdPackageName = '@snapdragon-ai/sd';
export const sdCommandName = 'sd';
