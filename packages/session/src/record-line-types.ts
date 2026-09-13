export interface RecordLineReaderOptions {
  maxLineChars?: number;
  tailLineChars?: number;
  retainFullLine?: (prefix: string) => boolean | undefined;
}
