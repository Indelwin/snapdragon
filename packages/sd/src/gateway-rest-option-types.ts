import type { GatewayRestServerOptions } from '@snapdragon-ai/gateway';

export interface GatewayRestServeParsedOptions extends GatewayRestServerOptions {
  json: boolean;
  readyFile?: string;
}
