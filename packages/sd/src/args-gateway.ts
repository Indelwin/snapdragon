import type { SdCliArgs } from './args-types.js';

export function applyGatewayToken(raw: string, out: SdCliArgs, promptParts: string[]): boolean {
  if (raw === 'gateway' && out.mode === 'tui' && promptParts.length === 0) {
    out.mode = 'gateway';
    out.gatewayArgs = [];
    return true;
  }
  if (out.mode !== 'gateway') return false;
  out.gatewayArgs = [...(out.gatewayArgs ?? []), raw];
  return true;
}
