import type {
  ExtensionApplianceManifest,
  ExtensionDescriptor,
  MemoryProvider,
} from '@snapdragon-ai/content';
import type { GatewayServiceSpec } from '@snapdragon-ai/gateway';
import type { ProviderModel, ReasoningRequest, StreamingChatHandler } from '@snapdragon-ai/host';
import type { Toolset } from '@snapdragon-ai/tools';
import type { SdConfig, SdProviderConfig, SdProviderKind } from './config.js';
import type { SdProfileInfo } from './profile.js';
import type { SdRuntimeOptions } from './runtime-options.js';

export interface SdExtensionSkillRoot {
  root: string;
  source: 'extension';
  extensionId: string;
  writable?: boolean;
}

export interface SdExtensionProviderCreateOptions {
  id: string;
  model: string;
  kind: SdProviderKind;
  config: SdProviderConfig;
  env: NodeJS.ProcessEnv;
}

export interface SdExtensionProviderRuntime {
  handler: StreamingChatHandler;
  model?: string;
  reasoning?: ReasoningRequest;
}

export interface SdExtensionProviderFactory {
  create(options: SdExtensionProviderCreateOptions): SdExtensionProviderRuntime;
  listModels?(options: Omit<SdExtensionProviderCreateOptions, 'model'>): ProviderModel[];
}

export interface SdExtensionActivationContext {
  descriptor: ExtensionDescriptor;
  config: SdConfig;
  profile?: SdProfileInfo;
  options: SdRuntimeOptions;
  env: NodeJS.ProcessEnv;
  registerToolset(toolset: Toolset): void;
  registerSkillRoot(path: string, options?: { writable?: boolean }): void;
  registerMemoryProvider(id: string, provider: MemoryProvider): void;
  registerProvider(id: string, provider: SdExtensionProviderFactory): void;
  registerGatewayService(service: GatewayServiceSpec): void;
  registerAppliance(appliance: ExtensionApplianceManifest): void;
  log(message: string): void;
}

export interface SdExtensionModule {
  activate?(context: SdExtensionActivationContext): void | Promise<void>;
}

export interface SdExtensionRuntime {
  toolsets: Toolset[];
  skillRoots: SdExtensionSkillRoot[];
  memoryProviders: Map<string, MemoryProvider>;
  providers: Map<string, SdExtensionProviderFactory>;
  gatewayServices: GatewayServiceSpec[];
  appliances: ExtensionApplianceManifest[];
  logs: Array<{ extensionId: string; message: string }>;
  errors: Array<{ extensionId: string; message: string }>;
}
