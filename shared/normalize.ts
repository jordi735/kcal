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

// Unicode uppercase mappings can expand one character (ß → SS, ﬃ → FFI).
// Lowercase the expansion's tail so normalizing its result again is stable.
function capitalizeFirst(s: string): string {
  const first = [...s][0];
  if (first === undefined) return s;
  const upper = first.toUpperCase();
  const capital = [...upper][0]!;
  return (capital + upper.slice(capital.length).toLowerCase() + s.slice(first.length)).normalize('NFC');
}

export function normalizeProductName(raw: string): string {
  const s = cleanWhitespace(raw).normalize('NFC').toLowerCase();
  return capitalizeFirst(s);
}

export function normalizeBrandName(raw: string | null): string | null {
  if (raw === null) return null;
  const s = cleanWhitespace(raw).normalize('NFC').toLowerCase();
  if (s.length === 0) return null;
  return s.split(' ').map(capitalizeFirst).join(' ');
}

// Literal product search is case-insensitive, keeps accents, and treats canonically
// equivalent Unicode text alike. It deliberately has no wildcard syntax.
export function foldProductSearchText(value: string): string {
  return value.normalize('NFC').toLowerCase().normalize('NFC');
}

// Entry-group labels are user-authored display text. Preserve their casing,
// while applying the same predictable whitespace cleanup as product metadata.
export function normalizeEntryGroupName(raw: string): string {
  return cleanWhitespace(raw);
}
