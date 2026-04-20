// Tiny inline-style helpers. Concentrates CSS-variable casting in one place
// so callers don't litter `as any` across TSX.

import type { JSX } from 'preact';

// Pass `{'--fill-pct': '40%', '--bar-color': 'var(--macro-p)'}` — React/Preact
// CSSProperties doesn't type custom properties, so one cast here spares every
// callsite from writing its own `as any` pair.
export function cssVars(vars: Record<string, string | number>): JSX.CSSProperties {
  return vars as unknown as JSX.CSSProperties;
}
