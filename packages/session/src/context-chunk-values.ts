export function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

export function validContextRange(start: unknown, end: unknown): start is number {
  return positiveInteger(start) && positiveInteger(end) && start <= end;
}

export function nonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function validContextKind(value: unknown): boolean {
  return value === undefined || value === 'leaf' || value === 'rollup';
}

export function validContextDepth(value: unknown): boolean {
  return value === undefined || (Number.isSafeInteger(value) && Number(value) >= 0);
}
