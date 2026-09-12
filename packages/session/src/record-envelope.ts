export function hasRecordTypePrefix(line: string, type: string): boolean {
  return recordPrefix(type).test(line);
}

export function recordIdFromPrefix(line: string, type: string, field: string): number | undefined {
  const match = new RegExp(
    `^\\s*\\{\\s*"${typeField()}"\\s*:\\s*"${escapeRegex(type)}"\\s*,\\s*"${escapeRegex(field)}"\\s*:\\s*(\\d+)(?:\\s*,|\\s*\\})`,
  ).exec(line);
  return match ? Number(match[1]) : undefined;
}

function recordPrefix(type: string): RegExp {
  return new RegExp(`^\\s*\\{\\s*"${typeField()}"\\s*:\\s*"${escapeRegex(type)}"(?:\\s*,|\\s*\\})`);
}

function typeField(): string {
  return 'type';
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
