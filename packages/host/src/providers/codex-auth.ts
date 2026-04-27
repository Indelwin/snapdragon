import { createHash, randomBytes } from 'node:crypto';
import type { CodexAuth } from './codex.js';
import { type FetchLike, fetchImpl } from './shared.js';

export const CODEX_PROVIDER_ID = 'openai-codex';
export const CODEX_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
export const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token';
export const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const CODEX_JWT_CLAIM_PATH = 'https://api.openai.com/auth';
export const CODEX_SCOPE = 'openid profile email offline_access';
export const CODEX_REFRESH_SKEW_SECONDS = 60;

export interface CodexPkce {
  verifier: string;
  challenge: string;
}

export interface CodexTokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

export interface CodexAuthRecord {
  type: 'oauth';
  provider: typeof CODEX_PROVIDER_ID;
  access_token: string;
  refresh_token: string;
  account_id: string;
  expires_at: number;
  connected_at: string;
}

export interface CodexAuthorizeUrlOptions {
  redirectUri: string;
  state: string;
  codeChallenge: string;
  originator?: string;
}

export interface CodexExchangeCodeOptions {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  fetch?: FetchLike;
}

export interface CodexRefreshOptions {
  fetch?: FetchLike;
}

export function generateCodexPkce(): CodexPkce {
  const verifier = base64UrlEncode(randomBytes(48));
  const challenge = base64UrlEncode(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function generateCodexState(): string {
  return randomBytes(16).toString('hex');
}

export function codexAuthorizeUrl(options: CodexAuthorizeUrlOptions): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CODEX_CLIENT_ID,
    redirect_uri: options.redirectUri,
    scope: CODEX_SCOPE,
    code_challenge: options.codeChallenge,
    code_challenge_method: 'S256',
    state: options.state,
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    originator: options.originator ?? 'snapdragon',
  });
  return `${CODEX_AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeCodexCode(
  options: CodexExchangeCodeOptions,
): Promise<CodexAuthRecord> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CODEX_CLIENT_ID,
    code: options.code,
    code_verifier: options.codeVerifier,
    redirect_uri: options.redirectUri,
  });

  const response = await fetchImpl(options.fetch)(CODEX_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) await throwCodexAuthError('codex token exchange', response);

  const token = (await response.json()) as CodexTokenResponse;
  if (!token.access_token || !token.refresh_token) {
    throw new Error(`codex token exchange missing required fields: ${JSON.stringify(token)}`);
  }
  return codexAuthRecordFromToken({
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expires_in: token.expires_in,
  });
}

export async function refreshCodexAuthRecord(
  current: CodexAuthRecord,
  options: CodexRefreshOptions = {},
): Promise<CodexAuthRecord> {
  const body = {
    grant_type: 'refresh_token',
    refresh_token: current.refresh_token,
    client_id: CODEX_CLIENT_ID,
    scope: 'openid profile email',
  };

  const response = await fetchImpl(options.fetch)(CODEX_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) await throwCodexAuthError('codex refresh', response);

  const token = (await response.json()) as CodexTokenResponse;
  return codexAuthRecordFromToken({
    access_token: token.access_token ?? current.access_token,
    refresh_token: token.refresh_token ?? current.refresh_token,
    expires_in: token.expires_in,
  });
}

export function codexAuthFromRecord(record: CodexAuthRecord): CodexAuth {
  return {
    accessToken: record.access_token,
    accountId: record.account_id,
  };
}

export function codexAuthRecordFromToken(token: {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  connected_at?: string;
}): CodexAuthRecord {
  const accountId = extractCodexAccountId(token.access_token);
  return {
    type: 'oauth',
    provider: CODEX_PROVIDER_ID,
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    account_id: accountId,
    expires_at:
      token.expires_in !== undefined
        ? Math.floor(Date.now() / 1000) + token.expires_in
        : codexAccessTokenExpiresAt(token.access_token),
    connected_at: token.connected_at ?? new Date().toISOString(),
  };
}

export function codexAccessTokenExpiresAt(accessToken: string): number {
  const payload = decodeJwtPayload(accessToken);
  if (typeof payload.exp !== 'number') {
    throw new Error('codex access_token is missing exp claim');
  }
  return payload.exp;
}

export function codexAuthNeedsRefresh(
  record: Pick<CodexAuthRecord, 'expires_at'>,
  now: () => number = () => Math.floor(Date.now() / 1000),
): boolean {
  return record.expires_at - now() <= CODEX_REFRESH_SKEW_SECONDS;
}

export function extractCodexAccountId(accessToken: string): string {
  const parts = accessToken.split('.');
  if (parts.length !== 3) {
    throw new Error('codex access_token is not a JWT (expected 3 parts)');
  }
  const payload = decodeJwtPayload(accessToken);
  const authClaims = payload[CODEX_JWT_CLAIM_PATH] as Record<string, unknown> | undefined;
  const accountId = authClaims?.chatgpt_account_id;
  if (typeof accountId !== 'string' || accountId.length === 0) {
    throw new Error('codex access_token is missing chatgpt_account_id claim');
  }
  return accountId;
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split('.');
  if (parts.length !== 3) {
    throw new Error('codex access_token is not a JWT (expected 3 parts)');
  }
  return JSON.parse(Buffer.from(base64UrlPad(parts[1]), 'base64').toString('utf8')) as Record<
    string,
    unknown
  >;
}

async function throwCodexAuthError(prefix: string, response: Response): Promise<never> {
  const text = await response.text().catch(() => '<no body>');
  throw new Error(`${prefix} ${response.status}: ${text}`);
}

function base64UrlEncode(bytes: Buffer | Uint8Array): string {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlPad(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const mod = padded.length % 4;
  return mod === 0 ? padded : padded + '='.repeat(4 - mod);
}
