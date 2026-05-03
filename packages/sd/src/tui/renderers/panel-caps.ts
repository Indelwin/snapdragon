/**
 * Height-budget helpers for the right-side ToolPanel + EventLog stack.
 * Extracted so `panels.tsx` stays a thin JSX shell and the math can be
 * unit-tested directly.
 */

const TOOL_ROWS_OVERHEAD = 3; // border (2) + title row
const EVENT_ROWS_OVERHEAD = 4; // border (2) + title row + spacer
const MIN_TOOL_ENTRIES = 3;
const MAX_TOOL_ENTRIES = 10;
const DEFAULT_PANEL_ROWS = 24;

export function toolEntryCap(viewportRows?: number): number {
  const rows = panelRows(viewportRows);
  // Tools shouldn't claim more than ~⅓ of the column when events is also on.
  const budget = Math.max(MIN_TOOL_ENTRIES, Math.floor(rows / 3) - TOOL_ROWS_OVERHEAD);
  return Math.min(MAX_TOOL_ENTRIES, budget);
}

export function eventEntryCap(viewportRows?: number): number {
  const rows = panelRows(viewportRows);
  return Math.max(1, rows - EVENT_ROWS_OVERHEAD);
}

function panelRows(viewportRows?: number): number {
  return typeof viewportRows === 'number' && viewportRows > 0 ? viewportRows : DEFAULT_PANEL_ROWS;
}
