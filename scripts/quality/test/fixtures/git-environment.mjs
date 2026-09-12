import { devNull } from 'node:os';

export function fixtureGitEnvironment(source = process.env) {
  const env = Object.fromEntries(Object.entries(source).filter(([key]) => !key.startsWith('GIT_')));
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull };
}
