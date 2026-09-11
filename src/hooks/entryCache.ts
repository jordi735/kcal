import { sumMacros, type EntryWithMacros, type Macros } from '../types';

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
