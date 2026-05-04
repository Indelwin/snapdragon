import { access, readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import ts from 'typescript';

const EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx'];

export async function fileImports(file, root) {
  const source = ts.createSourceFile(
    file,
    await readFile(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const imports = [];
  source.forEachChild((node) => collectImport(node, imports));
  return Promise.all(imports.map((specifier) => resolveImport(file, specifier, root)));
}

export function packageName(file) {
  const match = normalize(file).match(/\/packages\/([^/]+)\//);
  return match?.[1];
}

function collectImport(node, imports) {
  const specifier = importSpecifier(node);
  if (specifier) imports.push(specifier);
}

function importSpecifier(node) {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    return literalText(node.moduleSpecifier);
  }
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return literalText(node.arguments[0]);
  }
  return undefined;
}

function literalText(node) {
  return node && ts.isStringLiteral(node) ? node.text : undefined;
}

async function resolveImport(fromFile, specifier, root) {
  const external = !specifier.startsWith('.');
  const target = external ? specifier : await resolveFile(join(dirname(fromFile), specifier));
  return { specifier, external, target, root };
}

async function resolveFile(base) {
  for (const candidate of candidates(base)) {
    if (await exists(candidate)) return candidate;
  }
  return normalize(base);
}

function candidates(base) {
  if (!extname(base)) return EXTENSIONS.map((ext) => normalize(`${base}${ext}`));
  if (base.endsWith('.js')) return [replaceExt(base, '.ts'), replaceExt(base, '.tsx'), base];
  if (base.endsWith('.jsx')) return [replaceExt(base, '.tsx'), base];
  return [base];
}

function replaceExt(file, ext) {
  return normalize(file.replace(/\.[^.]+$/, ext));
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
