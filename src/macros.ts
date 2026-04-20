// Single source of truth for the three editable macros (protein/carbs/fat).
// UI components iterate MACRO_KEYS and look up display metadata in MACRO_META
// instead of hardcoding color / label / short-letter per call site.
//
// Kcal is intentionally NOT a MacroKey: it's a scalar derived from the other
// three at the product level, rendered separately (no bar color, no per-field
// tint), and usually gets whole-number formatting while macros get 1 decimal.

export type MacroKey = 'protein' | 'carbs' | 'fat';

export const MACRO_KEYS: readonly MacroKey[] = ['protein', 'carbs', 'fat'];

export type MacroMeta = {
  label: string;
  short: string;
  color: string;
  colorDim: string;
};

export const MACRO_META: Record<MacroKey, MacroMeta> = {
  protein: { label: 'Protein', short: 'P', color: 'var(--macro-p)', colorDim: 'var(--macro-p-dim)' },
  carbs:   { label: 'Carbs',   short: 'C', color: 'var(--macro-c)', colorDim: 'var(--macro-c-dim)' },
  fat:     { label: 'Fat',     short: 'F', color: 'var(--macro-f)', colorDim: 'var(--macro-f-dim)' },
};
