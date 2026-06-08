import type { RustGatewayCall } from './rust-call.js';
import { fromWireServiceStatus } from './rust-wire-status.js';
import type { GatewayServiceRunner, GatewayServiceStatus } from './types.js';

export async function runRustService(
  call: RustGatewayCall,
  name: string,
  runner: GatewayServiceRunner | undefined,
  serviceRunTimeoutMs: number,
  signal?: AbortSignal,
): Promise<GatewayServiceStatus | undefined> {
  if (!runner) {
    const status = await call('services.run', { name }, serviceRunTimeoutMs);
    return status ? fromWireServiceStatus(status as any) : undefined;
  }
  try {
    const result = await runner.run(signal);
    const status = await call('services.record_run', {
      name,
      at_ms: Date.now(),
      summary: result?.summary,
    });
    return status ? fromWireServiceStatus(status as any) : undefined;
  } catch (error) {
    return fromWireServiceStatus(
      (await call('services.error', {
        name,
        error: error instanceof Error ? error.message : String(error),
      })) as any,
    );
  }
}

export async function listRustServices(call: RustGatewayCall): Promise<GatewayServiceStatus[]> {
  const services = (await call('services.list')) as any[];
  return services.map(fromWireServiceStatus);
}
