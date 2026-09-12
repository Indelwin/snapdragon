import type { SdRestartState } from './reload.js';

export function parseRestartState(value: unknown): SdRestartState {
  if (!isRestartState(value)) throw new Error('Invalid Snapdragon restart state.');
  return value;
}

function isRestartState(value: unknown): value is SdRestartState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<SdRestartState>;
  return (
    nonEmptyString(state.provider) &&
    nonEmptyString(state.model) &&
    typeof state.noSession === 'boolean' &&
    typeof state.noProfile === 'boolean' &&
    validSessionState(state) &&
    validProfileState(state) &&
    (state.draft === undefined || typeof state.draft === 'string')
  );
}

function validSessionState(state: Partial<SdRestartState>): boolean {
  return state.noSession === true || nonEmptyString(state.sessionId);
}

function validProfileState(state: Partial<SdRestartState>): boolean {
  return state.noProfile === true || nonEmptyString(state.profileName);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
