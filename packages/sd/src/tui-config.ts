/**
 * TUI runtime configuration.
 *
 * Kept in its own module so the (per-file) complexity score on `config.ts`
 * doesn't grow every time we add an opt-in TUI knob. Re-exported from
 * `config.ts` for convenience and to keep the existing import surface stable.
 */

export interface SdTuiMouseConfig {
  enabled?: boolean;
  /** Rows to scroll per wheel tick. Default 3. */
  scroll_rows?: number;
}

export interface SdTuiConfig {
  mouse?: SdTuiMouseConfig;
}
