/**
 * Read images and text from the host operating system's clipboard.
 *
 * Snapdragon supports `/paste` so a user can attach a screenshot or copied
 * text to their next prompt without leaving the terminal. Different
 * terminals (iTerm2, Kitty, tmux) all share the same OS clipboard, so we
 * deliberately go around the terminal and read the OS clipboard directly.
 *
 * Currently only macOS is implemented:
 *
 * - Images: `osascript -e '... the clipboard as «class PNGf»'` returns the
 *   PNG bytes as an AppleScript hex literal (`«data PNGf...»`). We strip
 *   the wrapper and decode hex into a Buffer. This intentionally returns
 *   only PNG so we can be confident about the media type — Anthropic and
 *   the OpenAI Responses API both accept image/png unconditionally.
 *
 * - Text: `pbpaste` returns the clipboard as UTF-8.
 *
 * The `runner` option is a small seam for tests: it lets us replace the
 * `execFile` call with a fake without touching the rest of the wiring.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { attachmentFromReference, type PendingAttachment } from './attachments.js';

const execFileAsync = promisify(execFile);

/** Output of a clipboard probe call. */
export interface ClipboardRunResult {
  stdout: string;
  /** Process stderr, if the runner produced any. */
  stderr?: string;
  /** Non-zero exit code or signal name, if the process failed. */
  failed?: boolean;
}

/**
 * Test seam — replace `execFile` for clipboard probing.
 *
 * In production this defaults to `child_process.execFile` with a 2-second
 * timeout. Tests inject a fake to avoid touching the real OS clipboard.
 */
export type ClipboardRunner = (
  command: string,
  args: readonly string[],
) => Promise<ClipboardRunResult>;

export interface ClipboardOptions {
  runner?: ClipboardRunner;
  platform?: NodeJS.Platform;
}

export interface ClipboardImage {
  data: Buffer;
  mediaType: 'image/png';
}

export interface ClipboardText {
  text: string;
}

/** Return true if the current platform has a clipboard implementation. */
export function clipboardSupported(options: ClipboardOptions = {}): boolean {
  return (options.platform ?? process.platform) === 'darwin';
}

/**
 * Best-effort error message for unsupported platforms.
 * Always returns a string so callers can surface it without branching.
 */
export function unsupportedPlatformMessage(options: ClipboardOptions = {}): string {
  const platform = options.platform ?? process.platform;
  return `Clipboard reading is not yet implemented on ${platform}; only macOS (darwin) is supported.`;
}

function requireSupported(options: ClipboardOptions): ClipboardRunner {
  if (!clipboardSupported(options)) {
    throw new Error(unsupportedPlatformMessage(options));
  }
  return options.runner ?? defaultRunner;
}

/**
 * Read a PNG image off the OS clipboard, or return `null` if the clipboard
 * does not currently hold image data we can decode.
 *
 * Throws on unsupported platforms. Callers that want graceful degradation
 * should check `clipboardSupported()` first.
 */
export async function readClipboardImage(
  options: ClipboardOptions = {},
): Promise<ClipboardImage | null> {
  const runner = requireSupported(options);
  // AppleScript: ask for the clipboard coerced to PNG. This fails (without
  // crashing) when the clipboard does not contain image data.
  const result = await runner('osascript', [
    '-e',
    'try',
    '-e',
    'set png to the clipboard as «class PNGf»',
    '-e',
    'return png',
    '-e',
    'on error',
    '-e',
    'return ""',
    '-e',
    'end try',
  ]);
  if (result.failed) return null;
  const data = parseAppleScriptHex(result.stdout);
  if (!data || data.length === 0) return null;
  return { data, mediaType: 'image/png' };
}

/**
 * Read UTF-8 text off the OS clipboard, or return `null` if the clipboard
 * is empty.
 */
export async function readClipboardText(
  options: ClipboardOptions = {},
): Promise<ClipboardText | null> {
  const runner = requireSupported(options);
  const result = await runner('pbpaste', []);
  if (result.failed) return null;
  const text = result.stdout;
  if (text.length === 0) return null;
  return { text };
}

export interface PasteImageOptions extends ClipboardOptions {
  /**
   * Directory to persist the captured PNG in. The image is named after a
   * short content hash so identical paste-twice doesn't bloat the dir.
   */
  attachmentsDir: string;
  /**
   * Working directory for resolving the eventual attachment reference.
   * Generally `runtime.agent.cwd`.
   */
  cwd: string;
}

/**
 * Capture an image from the clipboard and turn it into a `PendingAttachment`
 * pointing at a persisted PNG inside `attachmentsDir`.
 *
 * Returns `null` if the clipboard does not currently hold an image.
 */
export async function pasteImageAttachment(
  options: PasteImageOptions,
): Promise<PendingAttachment | null> {
  const image = await readClipboardImage(options);
  if (!image) return null;
  const hash = createHash('sha256').update(image.data).digest('hex').slice(0, 12);
  const filePath = join(options.attachmentsDir, `clipboard-${hash}.png`);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, image.data);
  return attachmentFromReference(filePath, options.cwd);
}

/**
 * Default runner used in production. Wraps `execFile` so we never invoke a
 * shell, and translates non-zero exits into `failed: true` instead of
 * raising — clipboard probes are expected to fail (e.g. empty clipboard).
 */
const defaultRunner: ClipboardRunner = async (command, args) => {
  try {
    const { stdout, stderr } = await execFileAsync(command, [...args], {
      timeout: 2000,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { stdout, stderr };
  } catch (error) {
    const errObj = error as Record<string, unknown>;
    const stdout = typeof errObj.stdout === 'string' ? errObj.stdout : '';
    const stderr = typeof errObj.stderr === 'string' ? errObj.stderr : undefined;
    return { stdout, stderr, failed: true };
  }
};

/**
 * Parse an AppleScript `«data PNGfXXXX»` literal (or a bare hex blob) into
 * raw bytes. Returns `null` if no parseable hex was found.
 */
export function parseAppleScriptHex(raw: string): Buffer | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  // Match the AppleScript wrapper: «data TYPEHEX». The 4-char OSType code
  // (e.g. "PNGf") sits between the keyword and the hex payload — fix its
  // length explicitly because some OSType codes are themselves valid hex
  // (e.g. "C0FE") and a greedy `\w+` would swallow them.
  const wrapped = trimmed.match(/«data\s+[\w ]{4}([0-9A-Fa-f]+)»/);
  const hex = wrapped ? wrapped[1] : trimmed;
  if (!hex || hex.length === 0) return null;
  if (hex.length % 2 !== 0) return null;
  if (!/^[0-9A-Fa-f]+$/.test(hex)) return null;
  return Buffer.from(hex, 'hex');
}
