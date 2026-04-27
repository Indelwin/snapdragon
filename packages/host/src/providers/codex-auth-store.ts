import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import type { CodexAuth } from './codex.js';
import {
  CODEX_PROVIDER_ID,
  type CodexAuthRecord,
  type CodexRefreshOptions,
  codexAuthFromRecord,
  codexAuthNeedsRefresh,
  codexAuthRecordFromToken,
  refreshCodexAuthRecord,
} from './codex-auth.js';

export const DEFAULT_CODEX_AUTH_STORE_PATH = `${homedir()}/.snapdragon/auth/codex.json`;
export const DEFAULT_CODEX_CLI_AUTH_STORE_PATH = `${homedir()}/.codex/auth.json`;

let refreshInFlight: Promise<CodexAuthRecord> | null = null;

export async function saveCodexAuthRecord(
  record: CodexAuthRecord,
  path = DEFAULT_CODEX_AUTH_STORE_PATH,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  await chmod(path, 0o600).catch(() => undefined);
}

export async function loadCodexAuthRecord(
  path = DEFAULT_CODEX_AUTH_STORE_PATH,
): Promise<CodexAuthRecord | null> {
  try {
    const raw = await readFile(path, 'utf8');
    if (raw.trim().length === 0) return null;
    return parseCodexAuthRecord(JSON.parse(raw));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw error;
  }
}

export async function deleteCodexAuthRecord(path = DEFAULT_CODEX_AUTH_STORE_PATH): Promise<void> {
  await unlink(path).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
  });
}

export async function loadValidCodexAuthRecord(
  options: {
    path?: string;
    codexCliAuthPath?: string;
    useCodexCliFallback?: boolean;
    now?: () => number;
  } & CodexRefreshOptions = {},
): Promise<CodexAuthRecord> {
  const path = options.path ?? DEFAULT_CODEX_AUTH_STORE_PATH;
  const current = await loadCodexAuthRecord(path);
  if (!current) {
    return loadCodexCliFallback(options);
  }
  if (!codexAuthNeedsRefresh(current, options.now)) return current;

  if (!refreshInFlight) {
    refreshInFlight = refreshCodexAuthRecord(current, { fetch: options.fetch })
      .then(async (refreshed) => {
        await saveCodexAuthRecord(refreshed, path);
        return refreshed;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  try {
    return await refreshInFlight;
  } catch (error) {
    return loadCodexCliFallback(options, error);
  }
}

export async function loadValidCodexAuth(
  options: {
    path?: string;
    codexCliAuthPath?: string;
    useCodexCliFallback?: boolean;
    now?: () => number;
  } & CodexRefreshOptions = {},
): Promise<CodexAuth> {
  return codexAuthFromRecord(await loadValidCodexAuthRecord(options));
}

export async function loadCodexCliAuthRecord(
  path = DEFAULT_CODEX_CLI_AUTH_STORE_PATH,
): Promise<CodexAuthRecord | null> {
  try {
    const raw = await readFile(path, 'utf8');
    if (raw.trim().length === 0) return null;
    return parseCodexCliAuthRecord(JSON.parse(raw));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw error;
  }
}

export async function codexAuthSnapshot(path = DEFAULT_CODEX_AUTH_STORE_PATH): Promise<
  | { connected: false }
  | {
      connected: true;
      account_id: string;
      expires_at: number;
      expires_in_seconds: number;
      connected_at: string;
    }
> {
  const record = await loadCodexAuthRecord(path);
  if (!record) return { connected: false };
  const now = Math.floor(Date.now() / 1000);
  return {
    connected: true,
    account_id: record.account_id,
    expires_at: record.expires_at,
    expires_in_seconds: record.expires_at - now,
    connected_at: record.connected_at,
  };
}

function parseCodexAuthRecord(value: unknown): CodexAuthRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<CodexAuthRecord>;
  if (
    record.type !== 'oauth' ||
    record.provider !== CODEX_PROVIDER_ID ||
    typeof record.access_token !== 'string' ||
    typeof record.refresh_token !== 'string' ||
    typeof record.account_id !== 'string' ||
    typeof record.expires_at !== 'number' ||
    typeof record.connected_at !== 'string'
  ) {
    return null;
  }
  return record as CodexAuthRecord;
}

async function loadCodexCliFallback(
  options: {
    codexCliAuthPath?: string;
    useCodexCliFallback?: boolean;
    now?: () => number;
  },
  cause?: unknown,
): Promise<CodexAuthRecord> {
  if (options.useCodexCliFallback === false) {
    throw notConnectedError(cause);
  }
  const record = await loadCodexCliAuthRecord(options.codexCliAuthPath);
  if (!record) throw notConnectedError(cause);
  if (codexAuthNeedsRefresh(record, options.now)) {
    throw new Error('openai-codex auth is expired; refresh with Codex CLI or run a login flow');
  }
  return record;
}

function parseCodexCliAuthRecord(value: unknown): CodexAuthRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as {
    tokens?: {
      access_token?: unknown;
      refresh_token?: unknown;
      account_id?: unknown;
    };
    last_refresh?: unknown;
  };
  const accessToken = record.tokens?.access_token;
  const refreshToken = record.tokens?.refresh_token;
  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') return null;
  return codexAuthRecordFromToken({
    access_token: accessToken,
    refresh_token: refreshToken,
    connected_at: typeof record.last_refresh === 'string' ? record.last_refresh : undefined,
  });
}

function notConnectedError(cause: unknown): Error {
  const message = 'not connected to openai-codex; run an openai-codex login flow first';
  if (cause instanceof Error) return new Error(`${message} (${cause.message})`);
  return new Error(message);
}
