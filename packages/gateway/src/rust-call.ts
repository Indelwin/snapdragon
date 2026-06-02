export type RustGatewayCall = (
  method: string,
  params?: unknown,
  timeoutMs?: number,
) => Promise<unknown>;
