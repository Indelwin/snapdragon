import { readFile } from 'node:fs/promises';
import { type LearningDataset, learnEvalJobToGatewayJob } from '@snapdragon-ai/learn';
import type { SdCliArgs } from './args-types.js';
import { loadSdConfig } from './config.js';
import { gatewayErrorMessage, rustGatewayClientForConfig } from './gateway-command-client.js';

export async function learnCommand(
  action: string,
  rest: string[],
  args: SdCliArgs,
): Promise<string> {
  if (action === 'enqueue-eval') return enqueueEval(rest, args);
  return `Unknown gateway learn command: ${action}\n`;
}

async function enqueueEval(rest: string[], args: SdCliArgs): Promise<string> {
  const parsed = parseEvalArgs(rest);
  if (!parsed.datasetPath) return 'gateway learn enqueue-eval requires <dataset.json>\n';
  const dataset = JSON.parse(await readFile(parsed.datasetPath, 'utf8')) as LearningDataset;
  const job = learnEvalJobToGatewayJob(
    {
      id: parsed.id ?? `eval_${Date.now()}`,
      kind: 'eval',
      dataset: dataset.id,
      model: args.model,
    },
    dataset,
  );
  const config = await loadSdConfig(args.configPath);
  try {
    const enqueued = await rustGatewayClientForConfig(config).enqueueJob(job);
    return `enqueued learn eval ${enqueued.id}\n`;
  } catch (error) {
    return `Rust gateway unavailable: ${gatewayErrorMessage(error)}\n`;
  }
}

function parseEvalArgs(rest: string[]): { datasetPath?: string; id?: string } {
  const out: { datasetPath?: string; id?: string } = {};
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === '--id') out.id = rest[++index];
    else out.datasetPath = value;
  }
  return out;
}
