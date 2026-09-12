import { mkdir, open, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { PiRpcAgentRunResult, PiRpcObserverContext, PiRpcTraceSink } from './pi-rpc-types.js';

export async function writeOutputArtifact(
  outputArtifact: string,
  result: PiRpcAgentRunResult,
  cwd?: string,
): Promise<string> {
  const artifactPath = resolve(cwd ?? process.cwd(), outputArtifact);
  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return artifactPath;
}

export async function createTraceArtifactSink(
  outputArtifact: string,
  cwd?: string,
): Promise<PiRpcTraceSink> {
  const outputPath = resolve(cwd ?? process.cwd(), outputArtifact);
  const artifact = `${outputPath}.trace.jsonl`;
  await mkdir(dirname(artifact), { recursive: true });
  const file = await open(artifact, 'w');
  let closed = false;
  return {
    artifact,
    async write(event, context) {
      throwIfAborted(context);
      await file.appendFile(`${JSON.stringify(event)}\n`, 'utf8');
      throwIfAborted(context);
    },
    async close() {
      if (closed) return;
      closed = true;
      await file.close();
    },
  };
}

export function outputArtifactPath(outputArtifact: string, cwd?: string): string {
  return resolve(cwd ?? process.cwd(), outputArtifact);
}

function throwIfAborted(context: PiRpcObserverContext): void {
  if (!context.signal.aborted) return;
  throw context.signal.reason instanceof Error
    ? context.signal.reason
    : new Error('Pi RPC trace sink aborted');
}
