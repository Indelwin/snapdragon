/**
 * Heuristic: does this `run_shell` command look like it modifies or deletes
 * files in the working tree?  Used by sd's checkpoint middleware to decide
 * whether to take a snapshot before invoking `run_shell`.
 *
 * Deliberately conservative — false positives are cheap (an extra snapshot)
 * and false negatives are expensive (no safety net).  Cross-checked against
 * the patterns hermes-agent has tuned in the wild.
 */
const DESTRUCTIVE_PATTERNS = [
  // File deletion / move / overwrite-in-place.
  /\brm\b/,
  /\brmdir\b/,
  /\bmv\b/,
  /\bunlink\b/,
  /\btruncate\b/,
  /\bdd\s/,
  // In-place editors.
  /\bsed\s+(-[A-Za-z]*i|--in-place)\b/,
  /\bperl\s+(-[A-Za-z]*i|--in-place)/,
  // Git working-tree mutation.
  /\bgit\s+(reset|checkout|restore|clean|rebase|revert|cherry-pick|stash\s+pop|stash\s+drop|am\b|apply\b)/,
  // npm/cargo/pip (dependency mutation that touches lockfiles & node_modules).
  /\bnpm\s+(install|i|uninstall|remove|update|ci|prune)\b/,
  /\bcargo\s+(add|remove|update|clean)\b/,
  /\bpip\s+(install|uninstall)\b/,
];

const REDIRECT_OVERWRITE = /(^|[^>])>(?!>)/;

function matchesAnyDestructivePattern(command: string): boolean {
  return DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(command));
}

export function isDestructiveCommand(command: string): boolean {
  const trimmed = command?.trim() ?? '';
  if (!trimmed) return false;
  return REDIRECT_OVERWRITE.test(trimmed) || matchesAnyDestructivePattern(trimmed);
}
