// Canonical text normalization for product metadata. Every insert/update into
// products.name and products.brand must go through these helpers so stored
// data has a single, predictable shape.
//
// Product names: sentence case — "Franse magere kwark".
// Brand names:   title case    — "My Protein".
//
// Pipeline for both: trim → collapse internal whitespace → lowercase → recap.

function cleanWhitespace(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

export function normalizeProductName(raw: string): string {
  const s = cleanWhitespace(raw).toLowerCase();
  if (s.length === 0) return s;
  return s[0]!.toUpperCase() + s.slice(1);
}

export function normalizeBrandName(raw: string | null): string | null {
  if (raw === null) return null;
  const s = cleanWhitespace(raw).toLowerCase();
  if (s.length === 0) return null;
  return s.replace(/(^|\s)(\S)/g, (_m, ws: string, ch: string) => ws + ch.toUpperCase());
}
