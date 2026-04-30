export const maintainabilityLimits = {
  maxFileLines: 260,
  maxFunctionLines: 90,
  maxComplexity: 14,
  maxSeparationProxy: 42,
};

export function maintainabilityMetrics(text) {
  const lines = text.split(/\r?\n/);
  const complexity = textComplexity(stripComments(text));
  const exportedSymbols = countMatches(text, /\bexport\b/g);
  return {
    lines: lines.length,
    complexity,
    separationProxy: complexity + exportedSymbols,
    maxFunctionLines: Math.max(0, ...functionSpans(lines).map((fn) => fn.lines)),
  };
}

export function breachedMaintainability(metrics) {
  const out = [];
  if (metrics.lines > maintainabilityLimits.maxFileLines) {
    out.push(`${metrics.lines} lines exceeds ${maintainabilityLimits.maxFileLines}`);
  }
  if (metrics.complexity > maintainabilityLimits.maxComplexity) {
    out.push(`complexity ${metrics.complexity} exceeds ${maintainabilityLimits.maxComplexity}`);
  }
  if (metrics.separationProxy > maintainabilityLimits.maxSeparationProxy) {
    out.push(
      `separation proxy ${metrics.separationProxy} exceeds ${maintainabilityLimits.maxSeparationProxy}`,
    );
  }
  if (metrics.maxFunctionLines > maintainabilityLimits.maxFunctionLines) {
    out.push(`largest function spans ${metrics.maxFunctionLines} lines`);
  }
  return out;
}

export function worsenedMaintainability(metrics, allowed) {
  if (!allowed) return true;
  return (
    metrics.lines > allowed.lines ||
    metrics.complexity > allowed.complexity ||
    metrics.separationProxy > allowed.separationProxy ||
    metrics.maxFunctionLines > allowed.maxFunctionLines
  );
}

export function renderMaintainability(metrics) {
  return `lines=${metrics.lines}, complexity=${metrics.complexity}, separation=${metrics.separationProxy}, fn=${metrics.maxFunctionLines}`;
}

function textComplexity(text) {
  return (
    1 +
    countMatches(text, /\b(if|else if|for|while|case|catch|match)\b/g) +
    countMatches(text, /&&|\|\||\?/g)
  );
}

function countMatches(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function functionSpans(lines) {
  const spans = [];
  for (let i = 0; i < lines.length; i += 1) {
    const span = scanFunction(lines, i);
    if (!span) continue;
    spans.push(span);
    i = span.endIndex;
  }
  return spans;
}

function scanFunction(lines, start) {
  if (!/\b(function|async function|fn)\b|=>/.test(lines[start])) return undefined;
  let depth = 0;
  let seenBrace = false;
  for (let i = start; i < lines.length; i += 1) {
    for (const char of lines[i]) {
      if (char === '{') {
        depth += 1;
        seenBrace = true;
      } else if (char === '}') {
        depth -= 1;
      }
    }
    if (seenBrace && depth <= 0) return { line: start + 1, lines: i - start + 1, endIndex: i };
  }
  return undefined;
}
