export function textOrNull(value: string | undefined): string | null {
  if (value === undefined) return null;
  return value;
}

export function numberOrNull(value: number | undefined): number | null {
  if (value === undefined) return null;
  return value;
}

export function tagsText(value: readonly string[] | undefined): string {
  if (value === undefined) return '';
  return value.join(', ');
}
