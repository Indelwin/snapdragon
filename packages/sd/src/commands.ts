import type { ProviderModel } from '@snapdragon-ai/host';
import { attachmentFromReference, type PendingAttachment } from './attachments.js';
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
  resumeRuntimeSession,
  switchRuntimeProfile,
} from './runtime-transitions.js';
import { sessionCommandSummary } from './session-command-display.js';

export interface CommandResult {
  quit: boolean;
  attachments: PendingAttachment[];
}

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
  if (command === '/tools') return writeResult(io, toolsSummary(runtime), attachments);
  if (command === '/providers') return writeResult(io, providersSummary(runtime), attachments);
  if (command === '/provider') return providerCommand(arg, runtime, io, attachments);
  if (command === '/models') return modelsCommand(arg, runtime, io, attachments);
  if (command === '/model') return modelCommand(arg, runtime, io, attachments);
  if (command === '/attach') return attachImage(arg, runtime, attachments, io);
  if (command === '/clear-attachments') {
    return writeResult(io, 'Cleared pending attachments.', []);
  }

  io.error.write(`Unknown command: ${command}\n`);
  return { quit: false, attachments };
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
    const models = await discoverSdModels(runtime.config, providerId);
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
    '  /tools                List enabled tools',
    '  /providers            List configured providers',
    '  /provider [id] [model] Show or switch provider',
    '  /models [provider]    Discover/list provider models',
    '  /model [id]           Show or switch model on active provider',
    '  /attach <path-or-url> Attach an image to the next prompt',
    '  /clear-attachments    Clear pending attachments',
  ].join('\n');
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
