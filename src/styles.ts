// Shared inline-style helper for dynamic CSS custom properties.

import type { JSX } from 'preact';

// Pass `{'--fill-pct': '40%', '--bar-color': 'var(--macro-p)'}`. Preact accepts
// these properties directly; return the same object for use in a style prop.
export function cssVars(vars: Record<string, string | number>): JSX.CSSProperties {
  return vars;
}
