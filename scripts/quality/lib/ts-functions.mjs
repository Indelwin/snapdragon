import ts from 'typescript';

export function analyzeFunctions(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const functions = [];
  visit(source, source, functions);
  return functions;
}

export function lineForOffset(source, offset) {
  return source.getLineAndCharacterOfPosition(offset).line + 1;
}

export function changedFunction(fn, ranges) {
  return ranges.some((range) => range.start <= fn.endLine && range.end >= fn.startLine);
}

function visit(node, source, functions) {
  if (isFunctionLike(node) && node.body) functions.push(describeFunction(node, source));
  ts.forEachChild(node, (child) => visit(child, source, functions));
}

function describeFunction(node, source) {
  const start = node.getStart(source);
  const end = node.getEnd();
  return {
    name: functionName(node),
    start,
    end,
    startLine: lineForOffset(source, start),
    endLine: lineForOffset(source, end),
    complexity: complexity(node),
  };
}

function isFunctionLike(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node)
  );
}

function functionName(node) {
  if (node.name?.getText) return node.name.getText();
  if (ts.isVariableDeclaration(node.parent) && node.parent.name) return node.parent.name.getText();
  if (ts.isPropertyAssignment(node.parent) && node.parent.name) return node.parent.name.getText();
  return '<anonymous>';
}

function complexity(root) {
  let score = 1;
  walk(root.body, (node) => {
    if (isComplexityNode(node)) score += 1;
  });
  return score;
}

function walk(node, onNode) {
  if (!node) return;
  if (node !== undefined && node.kind !== undefined) onNode(node);
  ts.forEachChild(node, (child) => {
    if (isNestedFunction(child)) return;
    walk(child, onNode);
  });
}

function isNestedFunction(node) {
  return isFunctionLike(node);
}

function isComplexityNode(node) {
  return (
    ts.isIfStatement(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node) ||
    ts.isCaseClause(node) ||
    ts.isCatchClause(node) ||
    ts.isConditionalExpression(node) ||
    isLogicalBinary(node)
  );
}

function isLogicalBinary(node) {
  if (!ts.isBinaryExpression(node)) return false;
  return (
    node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
    node.operatorToken.kind === ts.SyntaxKind.BarBarToken
  );
}
