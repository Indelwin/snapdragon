import { homedir } from 'node:os';
import { resolve } from 'node:path';

export const DEFAULT_SD_CONFIG_PATH = resolve(homedir(), '.snapdragon/sd/config.yaml');
export const LEGACY_SD_CONFIG_PATH = resolve(homedir(), '.snapdragon/config.yaml');
export const DEFAULT_SD_ENV_PATH = resolve(homedir(), '.snapdragon/.env');
export const DEFAULT_SD_SESSION_ROOT = resolve(homedir(), '.snapdragon/sd/sessions');
export const DEFAULT_SD_MEMORY_ROOT = resolve(homedir(), '.snapdragon/sd/memory');
export const DEFAULT_SD_EXTENSION_ROOT = resolve(homedir(), '.snapdragon/sd/extensions');
export const DEFAULT_SD_TODO_PATH = resolve(homedir(), '.snapdragon/sd/todos.json');
export const DEFAULT_SD_DAEMON_ROOT = resolve(homedir(), '.snapdragon/sd/daemon');
export const DEFAULT_SD_SESSION_TITLE_PROVIDER = 'anthropic';
export const DEFAULT_SD_SESSION_TITLE_MODEL = 'claude-haiku-4-5-20251001';
