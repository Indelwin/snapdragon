import { appendFile } from 'node:fs/promises';
import type { SdConfig } from './config.js';
import {
  descriptorFrom,
  descriptorPath,
  ensureChannelDirectories,
  ensureChannelDirectoriesSync,
  listDescriptors,
  readExistingDescriptor,
  readExistingDescriptorSync,
  writeDescriptor,
  writeDescriptorSync,
} from './gateway-channel-files.js';

export {
  channelRootForTarget,
  gatewayChannelRootForConfig,
  normalizeGatewayChannelTarget,
  type SdGatewayChannelDescriptor,
  type SdGatewayChannelEnsureOptions,
  type SdGatewayChannelLogEntry,
  type SdGatewayChannelStore,
  type SdGatewayChannelTarget,
} from './gateway-channel-types.js';

import {
  defaultGatewayChannelPlatform,
  gatewayChannelRootForConfig,
  normalizeGatewayChannelPlatform,
  normalizeGatewayChannelTarget,
  type SdGatewayChannelDescriptor,
  type SdGatewayChannelEnsureOptions,
  type SdGatewayChannelLogEntry,
  type SdGatewayChannelStore,
} from './gateway-channel-types.js';

export function createSdGatewayChannelStore(config: SdConfig): SdGatewayChannelStore {
  return new FsGatewayChannelStore(
    gatewayChannelRootForConfig(config),
    defaultGatewayChannelPlatform(config),
  );
}

class FsGatewayChannelStore implements SdGatewayChannelStore {
  constructor(
    readonly root: string,
    private readonly defaultPlatform: string,
  ) {}

  async ensure(target: string, options: SdGatewayChannelEnsureOptions = {}) {
    const descriptor = await this.readOrCreateDescriptor(target, options);
    await ensureChannelDirectories(descriptor);
    await writeDescriptor(descriptor);
    return descriptor;
  }

  ensureSync(target: string, options: SdGatewayChannelEnsureOptions = {}) {
    const descriptor = this.readOrCreateDescriptorSync(target, options);
    ensureChannelDirectoriesSync(descriptor);
    writeDescriptorSync(descriptor);
    return descriptor;
  }

  async list(filter: { platform?: string } = {}) {
    return this.listSync(filter);
  }

  listSync(filter: { platform?: string } = {}) {
    const platform = filter.platform ? normalizeGatewayChannelPlatform(filter.platform) : undefined;
    return listDescriptors(this.root, platform);
  }

  async appendLog(target: string, entry: SdGatewayChannelLogEntry) {
    const channel = await this.ensure(target);
    const line = { at: new Date().toISOString(), ...entry };
    await appendFile(channel.log_file, `${JSON.stringify(line)}\n`);
  }

  private async readOrCreateDescriptor(
    target: string,
    options: SdGatewayChannelEnsureOptions,
  ): Promise<SdGatewayChannelDescriptor> {
    const normalized = normalizeGatewayChannelTarget(target, this.defaultPlatform);
    const existing = await readExistingDescriptor(descriptorPath(this.root, normalized));
    return descriptorFrom(normalized, this.root, options, existing);
  }

  private readOrCreateDescriptorSync(
    target: string,
    options: SdGatewayChannelEnsureOptions,
  ): SdGatewayChannelDescriptor {
    const normalized = normalizeGatewayChannelTarget(target, this.defaultPlatform);
    const existing = readExistingDescriptorSync(descriptorPath(this.root, normalized));
    return descriptorFrom(normalized, this.root, options, existing);
  }
}
