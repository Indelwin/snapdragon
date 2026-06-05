export interface LogAppendArgs {
  target?: string;
  message?: string;
  level?: string;
}

export function logAppendArgsFromParts(rest: string[]): LogAppendArgs {
  const level = optionValue(rest, '--level');
  const positional = stripOption(rest, '--level');
  const [target, ...messageParts] = positional;
  return { target, message: messageParts.join(' ').trim() || undefined, level };
}

function optionValue(parts: string[], option: string): string | undefined {
  const index = parts.indexOf(option);
  const value = index >= 0 ? parts[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : undefined;
}

function stripOption(parts: string[], option: string): string[] {
  const out: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part === option) {
      index += 1;
    } else if (part) {
      out.push(part);
    }
  }
  return out;
}
