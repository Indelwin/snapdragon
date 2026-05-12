// Argument validators with shapes too varied for the generic helpers
// in `toolset-helpers.ts`.

export function optionalStringArrayArg(
  args: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const value = args[key];
  if (value == null) return undefined;
  if (!Array.isArray(value)) throw new Error(`Expected array argument: ${key}`);
  return value.map((v) => {
    if (typeof v !== 'string') throw new Error(`Expected string in array: ${key}`);
    return v;
  });
}

export function optionalUseJina(value: unknown): boolean | 'auto' | undefined {
  if (value == null) return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'auto') return 'auto';
  throw new Error('useJina must be boolean or "auto"');
}
