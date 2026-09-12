export type MouseInputSource = NodeJS.ReadableStream & {
  isTTY?: boolean;
  readableFlowing?: boolean | null;
  setRawMode?: (enabled: boolean) => unknown;
  ref?: () => unknown;
  unref?: () => unknown;
};

export type MouseOutput = NodeJS.WritableStream & { isTTY?: boolean };
