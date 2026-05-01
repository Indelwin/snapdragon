import { asRecord } from './codex-record.js';
import { repairCodexToolOutputs } from './codex-tool-repair.js';

export function codexInputItems(input: unknown): unknown {
  if (!Array.isArray(input)) return input;
  return repairCodexToolOutputs(input.map((item, index) => codexInputItem(item, index)));
}

function codexInputItem(item: unknown, index: number): unknown {
  const record = asRecord(item);
  if (!isAssistantMessage(record)) return item;
  return completeAssistantMessage(record, index);
}

function isAssistantMessage(
  record: Record<string, unknown> | undefined,
): record is Record<string, unknown> {
  return record?.type === 'message' && record.role === 'assistant';
}

function completeAssistantMessage(
  record: Record<string, unknown>,
  index: number,
): Record<string, unknown> {
  return {
    ...record,
    id: record.id || `msg_${index}`,
    status: record.status || 'completed',
    content: assistantContent(record.content),
  };
}

function assistantContent(content: unknown): unknown {
  return Array.isArray(content) ? content.map(codexAssistantContentBlock) : content;
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
