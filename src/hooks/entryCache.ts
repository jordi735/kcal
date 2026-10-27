import type { EntryWithMacros, Macros, Product } from '../types';
import { computeMacros, sumMacros } from '../macros';

export type EntryCache = {
  entriesByDate: Record<string, EntryWithMacros[]>;
  weekTotals: Record<string, Macros>;
  loadedDates: Set<string>;
};

// Derivation eligibility comes from the calling mutation's loaded-date snapshot.
// Keep it explicit so a day loaded during a request does not change that policy.
export function updateCachedDay(
  cache: EntryCache,
  date: string,
  update: (entries: ReadonlyArray<EntryWithMacros>) => EntryWithMacros[],
  deriveTotals = false,
): EntryCache {
  const entries = update(cache.entriesByDate[date] ?? []);
  return {
    ...cache,
    entriesByDate: { ...cache.entriesByDate, [date]: entries },
    weekTotals: deriveTotals
      ? { ...cache.weekTotals, [date]: sumMacros(entries) }
      : cache.weekTotals,
  };
}

function projectCachedDays(
  cache: EntryCache,
  totalDates: ReadonlySet<string>,
  project: (date: string, entries: EntryWithMacros[]) => EntryWithMacros[],
): EntryCache {
  const entriesByDate = { ...cache.entriesByDate };
  const weekTotals = { ...cache.weekTotals };
  let changed = false;
  for (const [date, entries] of Object.entries(cache.entriesByDate)) {
    const next = project(date, entries);
    if (next === entries) continue;
    changed = true;
    entriesByDate[date] = next;
    // A partial cache must never replace a server's complete day total.
    if (cache.loadedDates.has(date) && totalDates.has(date)) weekTotals[date] = sumMacros(next);
  }
  return changed ? { ...cache, entriesByDate, weekTotals } : cache;
}

// Apply only after the product write commits. A read accepted during the write
// may be newer than its response, so those day snapshots retain their data.
export function updateCachedProduct(
  cache: EntryCache,
  product: Product,
  protectedDates: ReadonlySet<string>,
  totalDates: ReadonlySet<string>,
): EntryCache {
  return projectCachedDays(cache, totalDates, (date, entries) => {
    if (protectedDates.has(date) || !entries.some((entry) => entry.product.id === product.id)) return entries;
    return entries.map((entry) => entry.product.id === product.id
      ? { ...entry, product, macros: computeMacros(product, entry.amount) }
      : entry);
  });
}

export function removeCachedProduct(
  cache: EntryCache,
  productId: number,
  totalDates: ReadonlySet<string>,
): EntryCache {
  return projectCachedDays(cache, totalDates, (date, entries) => {
    const retained = entries.filter((entry) => entry.product.id !== productId);
    let changed = retained.length !== entries.length;
    if (!cache.loadedDates.has(date)) return changed ? retained : entries;

    // The server also dissolves underfilled groups. Count members only in a
    // complete current snapshot, preserving survivors from concurrent reads.
    const counts = new Map<number, number>();
    for (const entry of retained) {
      if (entry.group !== null) counts.set(entry.group.id, (counts.get(entry.group.id) ?? 0) + 1);
    }
    const ungrouped = retained.map((entry) => {
      if (entry.group === null || (counts.get(entry.group.id) ?? 0) >= 2) return entry;
      changed = true;
      return { ...entry, group: null };
    });
    return changed ? ungrouped : entries;
  });
}
