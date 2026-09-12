/** Production rendering is the CLI default; embedding hosts keep their environment. */
export function prepareCliEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  env.NODE_ENV ??= 'production';
}
