import { join } from 'node:path';
import type { ProviderModel } from '@snapdragon-ai/host';
import { attachmentFromReference, type PendingAttachment } from './attachments.js';
import {
  clipboardSupported,
  pasteImageAttachment,
  readClipboardText,
  unsupportedPlatformMessage,
} from './clipboard.js';
import {
  configuredModelsForProvider,
  discoverSdModels,
  listSdProviders,
  switchSdModel,
  switchSdProvider,
} from './provider.js';
import type { SdIo } from './repl.js';
import type { SdRuntime } from './runtime.js';
import {
  currentProfileName,
  deleteRuntimeSession,
  newRuntimeSession,
  rebuildSdRuntime,
  resumeRuntimeSession,
  switchRuntimeProfile,
} from './runtime-transitions.js';
import { sessionCommandSummary } from './session-command-display.js';
import { buildSkillInvocation, type SkillInvocation, skillForSlashCommand } from './skills.js';

export interface CommandResult {
  quit: boolean;
  attachments: PendingAttachment[];
  prompt?: CommandPromptRun;
}

export type CommandPromptRun = SkillInvocation;

export const BUILTIN_SLASH_COMMANDS = [
  '/help',
  '/quit',
  '/exit',
  '/clear',
  '/session',
  '/sessions',
  '/resume',
  '/new-session',
  '/delete-session',
  '/profiles',
  '/profile',
  '/memory',
  '/remember',
  '/extensions',
  '/skills',
  '/skill',
  '/tools',
  '/providers',
  '/provider',
  '/models',
  '/model',
  '/attach',
  '/paste',
  '/clear-attachments',
  '/events',
  '/palette',
];

export async function handleCommand(
  line: string,
  runtime: SdRuntime,
  attachments: PendingAttachment[],
  io: SdIo,
): Promise<CommandResult> {
  const [command = '', ...rest] = line.split(/\s+/);
  const arg = rest.join(' ').trim();
  if (command === '/quit' || command === '/exit') return { quit: true, attachments };
  if (command === '/help') return writeResult(io, slashHelp(), attachments);
  if (command === '/clear') return clearHistory(runtime, io, attachments);
  if (command === '/session' || command === '/sessions')
    return writeResult(io, sessionCommandSummary(command, runtime), attachments);
  if (command === '/resume') return resumeSessionCommand(arg, runtime, io, attachments);
  if (command === '/new-session') return newSessionCommand(arg, runtime, io, attachments);
  if (command === '/delete-session') return deleteSessionCommand(arg, runtime, io, attachments);
  if (command === '/profiles') return writeResult(io, profilesSummary(runtime), attachments);
  if (command === '/profile') return profileCommand(arg, runtime, io, attachments);
  if (command === '/memory') {
    if (arg === 'scan' || arg.startsWith('scan ')) {
      return writeResult(io, await memoryScanCommand(runtime), attachments);
    }
    return writeResult(io, await memorySummary(runtime, arg), attachments);
  }
  if (command === '/remember') return rememberCommand(arg, runtime, io, attachments);
  if (command === '/extensions') return extensionsCommand(arg, runtime, io, attachments);
  if (command === '/skills') return writeResult(io, skillsSummary(runtime), attachments);
  if (command === '/skill') return skillCommand(line, arg, runtime, io, attachments);
  if (command === '/tools') return writeResult(io, toolsSummary(runtime), attachments);
  if (command === '/providers') return writeResult(io, providersSummary(runtime), attachments);
  if (command === '/provider') return providerCommand(arg, runtime, io, attachments);
  if (command === '/models') return modelsCommand(arg, runtime, io, attachments);
  if (command === '/model') return modelCommand(arg, runtime, io, attachments);
  if (command === '/attach') return attachImage(arg, runtime, attachments, io);
  if (command === '/paste') return pasteCommand(arg, runtime, attachments, io);
  if (command === '/clear-attachments') {
    return writeResult(io, 'Cleared pending attachments.', []);
  }

  const skill = skillForSlashCommand(runtime.skills, command, BUILTIN_SLASH_COMMANDS);
  if (skill) {
    return skillPrompt(line, skill.id, arg, runtime, attachments);
  }

  io.error.write(`Unknown command: ${command}\n`);
  return { quit: false, attachments };
}

function skillCommand(
  line: string,
  arg: string,
  runtime: SdRuntime,
  io: SdIo,
  attachments: PendingAttachment[],
): CommandResult {
  if (!arg) return writeResult(io, skillsSummary(runtime), attachments);
  const [target = '', ...rest] = arg.split(/\s+/);
  return skillPrompt(line, target, rest.join(' ').trim(), runtime, attachments);
}

function skillPrompt(
  line: string,
  target: string,
  task: string,
  runtime: SdRuntime,
  attachments: PendingAttachment[],
): CommandResult {
  const skill = runtime.skills.load(target);
  if (!skill) {
    throw new Error(`Skill not found: ${target}`);
  }
  return {
    quit: false,
    attachments,
    prompt: buildSkillInvocation(skill, line, task),
  };
}

async function providerCommand(
  arg: string,
  runtime: SdRuntime,
  io: SdIo,
  attachments: PendingAttachment[],
): Promise<CommandResult> {
  if (!arg) return writeResult(io, providerSummary(runtime), attachments);
  const [providerId, model] = arg.split(/\s+/, 2);
  const provider = await switchSdProvider(runtime, providerId, model);
  return writeResult(io, `Switched to ${provider.id}/${provider.model}.`, attachments);
}

async function resumeSessionCommand(
  arg: string,
  runtime: SdRuntime,
  io: SdIo,
  attachments: PendingAttachment[],
): Promise<CommandResult> {
  const session = await resumeRuntimeSession(runtime, arg || undefined);
  return writeResult(io, `Resumed session ${session.sessionId}.`, attachments);
}

async function newSessionCommand(
  arg: string,
  runtime: SdRuntime,
  io: SdIo,
  attachments: PendingAttachment[],
): Promise<CommandResult> {
  const session = await newRuntimeSession(runtime, arg || undefined);
  return writeResult(io, `Started session ${session.sessionId}.`, attachments);
}

function deleteSessionCommand(
  arg: string,
  runtime: SdRuntime,
  io: SdIo,
  attachments: PendingAttachment[],
): CommandResult {
  if (!arg) return writeResult(io, 'Usage: /delete-session <id>', attachments);
  const deleted = deleteRuntimeSession(runtime, arg);
  return writeResult(
    io,
    deleted ? `Deleted session ${arg}.` : `Session not found: ${arg}.`,
    attachments,
  );
}

async function profileCommand(
  arg: string,
  runtime: SdRuntime,
  io: SdIo,
  attachments: PendingAttachment[],
): Promise<CommandResult> {
  if (!arg) return writeResult(io, profileSummary(runtime), attachments);
  const profile = await switchRuntimeProfile(runtime, arg === 'none' ? null : arg);
  const label = profile ? profile.name : 'none';
  return writeResult(io, `Profile active: ${label}.`, attachments);
}

async function modelCommand(
  arg: string,
  runtime: SdRuntime,
  io: SdIo,
  attachments: PendingAttachment[],
): Promise<CommandResult> {
  if (!arg) return writeResult(io, modelsSummary(runtime, runtime.provider.id), attachments);
  const [model] = arg.split(/\s+/, 1);
  const provider = await switchSdModel(runtime, model);
  return writeResult(io, `Switched to ${provider.id}/${provider.model}.`, attachments);
}

async function modelsCommand(
  arg: string,
  runtime: SdRuntime,
  io: SdIo,
  attachments: PendingAttachment[],
): Promise<CommandResult> {
  const providerId = arg || runtime.provider.id;
  const { models, warning } = await modelsForCommand(runtime, providerId);
  const lines = models.map((model) => {
    const active = providerId === runtime.provider.id && model.id === runtime.provider.model;
    const name = model.name && model.name !== model.id ? ` (${model.name})` : '';
    return `${active ? '*' : ' '} ${model.id}${name}`;
  });
  const heading = warning
    ? `Models for ${providerId} (configured fallback):`
    : `Models for ${providerId}:`;
  const footer = warning ? ['', `live discovery failed: ${warning}`] : [];
  return writeResult(io, [heading, ...lines, ...footer].join('\n'), attachments);
}

function writeResult(io: SdIo, text: string, attachments: PendingAttachment[]): CommandResult {
  io.output.write(`${text}\n`);
  return { quit: false, attachments };
}

function clearHistory(
  runtime: SdRuntime,
  io: SdIo,
  attachments: PendingAttachment[],
): CommandResult {
  runtime.agent.messages.splice(0, runtime.agent.messages.length);
  return writeResult(io, 'Cleared in-memory chat history.', attachments);
}

async function attachImage(
  arg: string,
  runtime: SdRuntime,
  attachments: PendingAttachment[],
  io: SdIo,
): Promise<CommandResult> {
  const attachment = await attachmentFromReference(arg, runtime.agent.cwd);
  const next = [...attachments, attachment];
  return writeResult(io, `Attached ${attachment.label} (${next.length} pending).`, next);
}

/**
 * `/paste` — pull an image (or text) from the OS clipboard. With no
 * argument we auto-detect: an image is preferred when present, otherwise
 * the clipboard's text contents are echoed back. Explicit `image` or
 * `text` arguments force one mode and produce a clear error if the
 * clipboard does not currently hold that kind of data.
 *
 * Pasted images are written to a session-scoped attachments directory
 * (`<sessionRoot>/<sessionId>.attachments/`) so they get cleaned up when
 * the session is deleted.
 */
async function pasteCommand(
  arg: string,
  runtime: SdRuntime,
  attachments: PendingAttachment[],
  io: SdIo,
): Promise<CommandResult> {
  if (!clipboardSupported()) {
    return writeResult(io, unsupportedPlatformMessage(), attachments);
  }
  const mode = arg.trim().toLowerCase();
  if (mode && mode !== 'image' && mode !== 'text') {
    return writeResult(
      io,
      `Unknown /paste mode: ${arg}. Use '/paste', '/paste image', or '/paste text'.`,
      attachments,
    );
  }

  if (mode !== 'text') {
    const dir = pasteAttachmentsDir(runtime);
    if (!dir) {
      // Image pasting needs a session directory to persist the file in.
      // Fall back to text mode if we asked for auto-detect; otherwise error.
      if (mode === 'image') {
        return writeResult(
          io,
          'Cannot paste image: no active session to store it in. Start a session first.',
          attachments,
        );
      }
    } else {
      const attachment = await pasteImageAttachment({
        attachmentsDir: dir,
        cwd: runtime.agent.cwd,
      });
      if (attachment) {
        const next = [...attachments, attachment];
        return writeResult(
          io,
          `Pasted image as ${attachment.label} (${next.length} pending).`,
          next,
        );
      }
      if (mode === 'image') {
        return writeResult(io, 'Clipboard does not contain an image.', attachments);
      }
    }
  }

  const text = await readClipboardText();
  if (!text) {
    return writeResult(io, 'Clipboard is empty.', attachments);
  }
  return writeResult(io, `Clipboard text:\n${text.text}`, attachments);
}

/**
 * Where to persist pasted images. Returns `undefined` when no session is
 * active (e.g. `--no-session` or one-shot runs) — we deliberately avoid
 * sprinkling temp PNGs around the user's filesystem in that case.
 */
function pasteAttachmentsDir(runtime: SdRuntime): string | undefined {
  if (!runtime.session || !runtime.sessionRoot) return undefined;
  return join(runtime.sessionRoot, `${runtime.session.sessionId}.attachments`);
}

function providerSummary(runtime: SdRuntime): string {
  return [
    `active: ${runtime.provider.id}/${runtime.provider.model} (${runtime.provider.kind})`,
    '',
    providersSummary(runtime),
  ].join('\n');
}

function providersSummary(runtime: SdRuntime): string {
  const lines = listSdProviders(runtime.config, runtime.provider.id).map((provider) => {
    const models = provider.models.length ? ` models: ${provider.models.join(', ')}` : '';
    return `${provider.active ? '*' : ' '} ${provider.id} (${provider.kind})${models}`;
  });
  return ['Providers:', ...lines].join('\n');
}

function modelsSummary(runtime: SdRuntime, providerId: string): string {
  const models = configuredModelsForProvider(runtime.config, providerId);
  const lines = models.map((model) => {
    const active = providerId === runtime.provider.id && model === runtime.provider.model;
    return `${active ? '*' : ' '} ${model}`;
  });
  return [`Configured models for ${providerId}:`, ...(lines.length ? lines : ['  (none)'])].join(
    '\n',
  );
}

async function modelsForCommand(
  runtime: SdRuntime,
  providerId: string,
): Promise<{ models: ProviderModel[]; warning?: string }> {
  try {
    const models = await discoverSdModels(
      runtime.config,
      providerId,
      runtime.env,
      runtime.extensionRuntime.providers,
    );
    if (models.length > 0) return { models };
    const configured = configuredProviderModels(runtime, providerId);
    if (configured.length > 0) {
      return { models: configured, warning: 'live discovery returned no models' };
    }
    return { models };
  } catch (error) {
    const configured = configuredProviderModels(runtime, providerId);
    if (configured.length === 0) throw error;
    return { models: configured, warning: errorMessage(error) };
  }
}

function configuredProviderModels(runtime: SdRuntime, providerId: string): ProviderModel[] {
  return configuredModelsForProvider(runtime.config, providerId).map((id) => ({
    id,
    source: 'static',
  }));
}

function slashHelp(): string {
  return [
    'Commands:',
    '  /help                 Show commands',
    '  /quit                 Exit',
    '  /clear                Clear in-memory chat history',
    '  /session              Show session details',
    '  /sessions             List sessions',
    '  /resume [id]          Resume a session',
    '  /new-session [id]     Start a new session',
    '  /delete-session <id>  Delete a session',
    '  /profiles             List profiles',
    '  /profile [name|none]  Show or switch profile',
    '  /memory [query]        Show or search durable memory',
    '  /remember <note>       Append a durable memory note',
    '  /extensions [reload]   List or reload discovered extensions',
    '  /skills               List skills',
    '  /skill <id> [task]    Run a skill for one request',
    '  /tools                List enabled tools',
    '  /providers            List configured providers',
    '  /provider [id] [model] Show or switch provider',
    '  /models [provider]    Discover/list provider models',
    '  /model [id]           Show or switch model on active provider',
    '  /attach <path-or-url> Attach an image to the next prompt',
    '  /paste [image|text]   Attach clipboard image or echo clipboard text',
    '  /clear-attachments    Clear pending attachments',
  ].join('\n');
}

async function memorySummary(runtime: SdRuntime, query: string): Promise<string> {
  if (runtime.config.memory?.enabled === false) return 'Memory is disabled.';
  if (query) {
    const results = await runtime.memory.search({ query, limit: 10 });
    return [
      `Memory matches for "${query}":`,
      ...(results.length
        ? results.map((entry) => `  ${entry.id} ${entry.title ?? ''} - ${entry.content}`)
        : ['  (none)']),
    ].join('\n');
  }
  const info = await runtime.memory.info();
  const entries = (await runtime.memory.read({ limit: 20 })).entries;
  return [
    `Memory: ${info.path ?? info.id}`,
    ...entries.map((entry) => `  ${entry.id} ${entry.title ?? ''}`.trimEnd()),
    entries.length === 0 ? '  (empty)' : '',
  ]
    .filter(Boolean)
    .join('\n');
}

async function memoryScanCommand(runtime: SdRuntime): Promise<string> {
  if (runtime.config.memory?.enabled === false) return 'Memory is disabled.';
  if (runtime.config.memory?.authoring === false) return 'Memory authoring is disabled.';
  const { runSdMemoryWorkerOnce } = await import('./memory-worker.js');
  const result = await runSdMemoryWorkerOnce({
    config: runtime.config,
    memory: runtime.memory,
    profile: runtime.profile,
  });
  return [
    'Memory worker scan:',
    `  sessions:    ${result.scanned_sessions}`,
    `  considered:  ${result.considered_messages}`,
    `  captured:    ${result.captured}`,
    `  duplicates:  ${result.skipped_duplicates}`,
    result.errors.length ? `  errors:      ${result.errors.length}` : undefined,
    ...result.errors.map((error) => `    ! ${error}`),
  ]
    .filter((line): line is string => typeof line === 'string')
    .join('\n');
}

async function rememberCommand(
  arg: string,
  runtime: SdRuntime,
  io: SdIo,
  attachments: PendingAttachment[],
): Promise<CommandResult> {
  if (!arg) return writeResult(io, 'Usage: /remember <note>', attachments);
  const result = await runtime.memory.append({
    title: 'Manual note',
    content: arg,
    source: 'sd.command',
  });
  return writeResult(
    io,
    result.success ? (result.message ?? 'Memory updated.') : (result.error ?? 'Memory failed.'),
    attachments,
  );
}

function extensionsSummary(runtime: SdRuntime): string {
  const extensions = runtime.extensions.list();
  if (extensions.length === 0) return 'No extensions found.';
  return [
    'Extensions:',
    ...extensions.map((extension) => {
      const enabled = extension.enabled ? '+' : '-';
      const capabilities = extension.capabilities?.length
        ? ` [${extension.capabilities.join(', ')}]`
        : '';
      const description = extension.description ? ` - ${extension.description}` : '';
      return `${enabled} ${extension.id} (${extension.name})${capabilities}${description}`;
    }),
    runtime.extensionRuntime.errors.length ? '' : undefined,
    ...runtime.extensionRuntime.errors.map((error) => `! ${error.extensionId}: ${error.message}`),
  ].join('\n');
}

async function extensionsCommand(
  arg: string,
  runtime: SdRuntime,
  io: SdIo,
  attachments: PendingAttachment[],
): Promise<CommandResult> {
  if (arg === 'reload') {
    await rebuildSdRuntime(runtime, {
      provider: runtime.provider.id,
      model: runtime.provider.model,
    });
    return writeResult(io, 'Reloaded extensions.', attachments);
  }
  return writeResult(io, extensionsSummary(runtime), attachments);
}

function profileSummary(runtime: SdRuntime): string {
  return [`active: ${currentProfileName(runtime)}`, '', profilesSummary(runtime)].join('\n');
}

function profilesSummary(runtime: SdRuntime): string {
  const profiles = runtime.profileStore.list();
  if (profiles.length === 0) return 'No profiles found.';
  return [
    'Profiles:',
    ...profiles.map((profile) => {
      if (!profile.valid) return `! ${profile.name} ${profile.error}`;
      const active = profile.name === runtime.profile?.name ? '*' : ' ';
      const description = profile.config?.description ? ` - ${profile.config.description}` : '';
      return `${active} ${profile.name}${description}`;
    }),
  ].join('\n');
}

function skillsSummary(runtime: SdRuntime): string {
  const skills = runtime.skills.list();
  if (skills.length === 0) return 'No skills found.';
  return [
    'Skills:',
    ...skills.map((skill) => `  ${skill.id} (${skill.command}) - ${skill.description}`),
  ].join('\n');
}

function toolsSummary(runtime: SdRuntime): string {
  const toolsets = runtime.agent.registry
    .listToolsets()
    .map((toolset) => `${toolset.enabled ? '+' : '-'} ${toolset.name}`)
    .join('\n');
  const tools = runtime.agent.registry
    .listEnabled()
    .map((tool) => `  ${tool.name} (${tool.toolset})`)
    .join('\n');
  return [`Toolsets:`, toolsets || '  (none)', '', 'Tools:', tools || '  (none)'].join('\n');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
