const SOURCE_RE = /\.(ts|tsx|js|jsx|rs)$/;
const JS_SOURCE_RE = /\.(ts|tsx|js|jsx)$/;
const GENERATED_PARTS = ['/dist/', '/node_modules/', '/target/', '/mutants.out'];

export function isAnalyzedSource(file) {
  if (!SOURCE_RE.test(file)) return false;
  if (GENERATED_PARTS.some((part) => file.includes(part))) return false;
  if (file.includes('/test/') || file.includes('/tests/') || file.includes('/features/'))
    return false;
  return !/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(file);
}

export function isAnalyzedJsSource(file) {
  return JS_SOURCE_RE.test(file) && isAnalyzedSource(file);
}

export function isPackageSource(file) {
  return /\/packages\/[^/]+\/src\//.test(file);
}
