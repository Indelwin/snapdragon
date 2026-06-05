export interface JobLifecycleOptions {
  worker?: string;
  queue?: string;
  leaseMs?: number;
}

export function lifecycleOptionsFromParts(parts: string[]): JobLifecycleOptions {
  const options = optionsFromParts(parts);
  return {
    worker: optionValue(options, 'worker'),
    queue: optionValue(options, 'queue'),
    leaseMs: positiveInt(optionValue(options, 'lease-ms') ?? optionValue(options, 'leaseMs')),
  };
}

export function resultFromParts(parts: string[]): unknown {
  const text = parts.join(' ');
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return { summary: text };
  }
}

function optionsFromParts(parts: string[]): Record<string, string[]> {
  const options: Record<string, string[]> = {};
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part?.startsWith('--')) continue;
    const value = parts[i + 1];
    if (!value || value.startsWith('--')) continue;
    options[part.slice(2)] = [...(options[part.slice(2)] ?? []), value];
    i += 1;
  }
  return options;
}

function optionValue(options: Record<string, string[]>, key: string): string | undefined {
  return options[key]?.[0];
}

function positiveInt(value: string | undefined): number | undefined {
  const parsed = value ? Number(value) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
