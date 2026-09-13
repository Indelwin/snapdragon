import type { GatewayClient, GatewayJobStatus } from '@snapdragon-ai/gateway';

export async function isJobCancelled(client: GatewayClient, jobId: string): Promise<boolean> {
  try {
    return (await client.showJob(jobId))?.state === 'cancelled';
  } catch {
    return false;
  }
}

export async function safeJobStatus(
  client: GatewayClient,
  jobId: string,
): Promise<GatewayJobStatus | undefined> {
  try {
    return await client.showJob(jobId);
  } catch {
    return undefined;
  }
}
