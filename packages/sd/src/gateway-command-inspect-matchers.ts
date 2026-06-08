export function optionMatches(expected: string | undefined, actual: string | undefined): boolean {
  return expected === undefined || expected === actual;
}

export function optionIncluded(
  expected: string | undefined,
  values: string[] | undefined,
): boolean {
  return expected === undefined || values?.includes(expected) === true;
}

export function optionOneOf(expected: string | undefined, values: (string | undefined)[]): boolean {
  return expected === undefined || values.includes(expected);
}
