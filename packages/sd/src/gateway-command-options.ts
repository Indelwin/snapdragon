export interface GatewayCommandOptions {
  stdout?: { write(chunk: string): unknown };
  signal?: AbortSignal;
  onRestListening?: (url: string) => void | Promise<void>;
}
