import { asRecord } from './codex-record.js';
import { repairCodexToolOutputs } from './codex-tool-repair.js';

export function codexInputItems(input: unknown): unknown {
  if (!Array.isArray(input)) return input;
  return repairCodexToolOutputs(input.map((item, index) => codexInputItem(item, index)));
}

function codexInputItem(item: unknown, index: number): unknown {
  const record = asRecord(item);
  if (!record) return item;
  if (record.type !== 'message') return record;
  if (record.role !== 'assistant') return record;
  let content = record.content;
  if (Array.isArray(content)) content = content.map(codexAssistantContentBlock);
  return {
    ...record,
    id: record.id || `msg_${index}`,
    status: record.status || 'completed',
    content,
  };
}

function codexAssistantContentBlock(block: unknown): unknown {
  const record = asRecord(block);
  if (!record) return block;
  if (record.type !== 'input_text') return record;
  const annotations = Array.isArray(record.annotations) ? record.annotations : [];
  return {
    ...record,
    type: 'output_text',
    annotations,
  };
}
