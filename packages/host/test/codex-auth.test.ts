import { strict as assert } from 'node:assert';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import {
  CODEX_AUTHORIZE_URL,
  CODEX_CLIENT_ID,
  type CodexAuthRecord,
  codexAccessTokenExpiresAt,
  codexAuthFromRecord,
  codexAuthorizeUrl,
  extractCodexAccountId,
  generateCodexPkce,
  generateCodexState,
} from '../src/providers/codex-auth.ts';
import {
  codexAuthSnapshot,
  deleteCodexAuthRecord,
  loadCodexAuthRecord,
  loadCodexCliAuthRecord,
  saveCodexAuthRecord,
} from '../src/providers/codex-auth-store.ts';

const tmpDirs: string[] = [];

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Codex PKCE and authorize URL use the Codex OAuth shape', () => {
  const pkce = generateCodexPkce();
  assert.ok(pkce.verifier.length >= 60);
  assert.doesNotMatch(pkce.verifier, /[+/=]/);
  assert.doesNotMatch(pkce.challenge, /[+/=]/);
  assert.notEqual(pkce.verifier, pkce.challenge);
  assert.match(generateCodexState(), /^[0-9a-f]{32}$/);

  const url = new URL(
    codexAuthorizeUrl({
      redirectUri: 'http://127.0.0.1:1455/callback',
      state: 'state_1',
      codeChallenge: 'challenge_1',
    }),
  );
  assert.equal(`${url.origin}${url.pathname}`, CODEX_AUTHORIZE_URL);
  assert.equal(url.searchParams.get('client_id'), CODEX_CLIENT_ID);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('originator'), 'snapdragon');
});

test('Codex account id extraction decodes the ChatGPT account claim', () => {
  const token = `${b64url({ alg: 'none' })}.${b64url({
    exp: 1234,
    'https://api.openai.com/auth': { chatgpt_account_id: 'acct_123' },
  })}.sig`;
  assert.equal(extractCodexAccountId(token), 'acct_123');
  assert.equal(codexAccessTokenExpiresAt(token), 1234);
  assert.throws(() => extractCodexAccountId(`${b64url({})}.${b64url({})}.sig`), {
    message: /chatgpt_account_id/,
  });
});

test('Codex CLI auth store can be adapted without exposing tokens', async () => {
  const path = await tempPath();
  const accessToken = `${b64url({ alg: 'none' })}.${b64url({
    exp: Math.floor(Date.now() / 1000) + 3600,
    'https://api.openai.com/auth': { chatgpt_account_id: 'acct_cli' },
  })}.sig`;
  await writeFile(
    path,
    JSON.stringify({
      auth_mode: 'chatgpt',
      tokens: {
        id_token: 'id.jwt.sig',
        access_token: accessToken,
        refresh_token: 'rt_cli',
        account_id: 'acct_cli',
      },
      last_refresh: '2026-04-27T00:00:00.000Z',
    }),
    'utf8',
  );

  const record = await loadCodexCliAuthRecord(path);
  assert.equal(record?.provider, 'openai-codex');
  assert.equal(record?.account_id, 'acct_cli');
  assert.equal(record?.refresh_token, 'rt_cli');
});

test('Codex auth store round trips, snapshots, and deletes records', async () => {
  const path = await tempPath();
  const record: CodexAuthRecord = {
    type: 'oauth',
    provider: 'openai-codex',
    access_token: 'at_1',
    refresh_token: 'rt_1',
    account_id: 'acct_123',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    connected_at: new Date().toISOString(),
  };

  await saveCodexAuthRecord(record, path);
  assert.deepEqual(await loadCodexAuthRecord(path), record);
  assert.deepEqual(codexAuthFromRecord(record), {
    accessToken: 'at_1',
    accountId: 'acct_123',
  });

  const snapshot = await codexAuthSnapshot(path);
  assert.equal(snapshot.connected, true);
  if (snapshot.connected) {
    assert.equal(snapshot.account_id, 'acct_123');
    assert.ok(snapshot.expires_in_seconds > 0);
  }

  await deleteCodexAuthRecord(path);
  assert.equal(await loadCodexAuthRecord(path), null);
});

async function tempPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'snapdragon-codex-auth-'));
  tmpDirs.push(dir);
  return join(dir, 'codex.json');
}

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}
