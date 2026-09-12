export type WebtoolsArtifactFailureKind =
  | 'manifest_missing'
  | 'manifest_corrupt'
  | 'artifact_missing'
  | 'artifact_corrupt';

export class WebtoolsArtifactError extends Error {
  readonly code = 'WEBTOOLS_ARTIFACT';

  constructor(
    readonly failure: WebtoolsArtifactFailureKind,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = 'WebtoolsArtifactError';
  }
}
