import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createSessionFile, type JsonlSession, openSessionFile } from './session.js';

export const DEFAULT_SESSION_ROOT = resolve(homedir(), '.snapdragon/sessions');

export interface SessionInfo {
  session_id: string;
  jsonl_path: string;
  jsonl_size: number;
  updated_at: number;
}

export interface SessionStoreOptions {
  root?: string;
}

export class SessionStore {
  readonly root: string;

  constructor(options: SessionStoreOptions = {}) {
    this.root = options.root ?? DEFAULT_SESSION_ROOT;
    mkdirSync(this.root, { recursive: true });
  }

  static generateId(now = new Date()): string {
    const pad = (value: number) => String(value).padStart(2, '0');
    const stamp =
      `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_` +
      `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    return `${stamp}_${Math.random().toString(16).slice(2, 8).padEnd(6, '0')}`;
  }

  pathsFor(sessionId: string): { jsonl: string } {
    return { jsonl: join(this.root, `${sessionId}.jsonl`) };
  }

  exists(sessionId: string): boolean {
    return existsSync(this.pathsFor(sessionId).jsonl);
  }

  create(sessionId = SessionStore.generateId(), meta?: Record<string, unknown>): JsonlSession {
    return createSessionFile({
      sessionId,
      jsonlPath: this.pathsFor(sessionId).jsonl,
      meta,
    });
  }

  open(sessionId: string): JsonlSession {
    return openSessionFile({
      sessionId,
      jsonlPath: this.pathsFor(sessionId).jsonl,
    });
  }

  openOrCreate(sessionId: string, meta?: Record<string, unknown>): JsonlSession {
    return this.exists(sessionId) ? this.open(sessionId) : this.create(sessionId, meta);
  }

  list(): SessionInfo[] {
    const sessions: SessionInfo[] = [];
    if (!existsSync(this.root)) return sessions;
    for (const entry of readdirSync(this.root)) {
      const info = this.infoFromEntry(entry);
      if (info) sessions.push(info);
    }
    return sessions.sort((a, b) => b.updated_at - a.updated_at);
  }

  delete(sessionId: string): boolean {
    const path = this.pathsFor(sessionId).jsonl;
    if (!existsSync(path)) return false;
    rmSync(path, { force: true });
    return true;
  }

  private infoFromEntry(entry: string): SessionInfo | undefined {
    if (!entry.endsWith('.jsonl')) return undefined;
    const path = join(this.root, entry);
    const stats = statSync(path);
    if (!stats.isFile()) return undefined;
    return {
      session_id: entry.slice(0, -'.jsonl'.length),
      jsonl_path: path,
      jsonl_size: stats.size,
      updated_at: stats.mtimeMs / 1000,
    };
  }
}
