export function workerId(value: string): string {
  const id = value.trim();
  if (!id) throw new Error('gateway worker id must be non-empty');
  if (!/^[A-Za-z0-9._:-]+$/.test(id)) {
    throw new Error('gateway worker id must contain only letters, numbers, ".", "_", "-", or ":"');
  }
  return id;
}

export function optionalWorkerField(field: string, value: string | undefined): string | undefined {
  return value === undefined ? undefined : workerField(field, value);
}

export function workerField(field: string, value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`gateway worker ${field} must be non-empty`);
  return normalized;
}
