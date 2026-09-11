// Owns the entries cache keyed by local_date; exposes CRUD helpers backed by /entries.

import { useCallback, useRef, useState } from 'preact/hooks';
import type { EntryGroup, EntryWithMacros, Macros } from '../types';
import { api } from '../api';
import { toLocalDateString } from '../dates';
import { updateCachedDay, type EntryCache } from './entryCache';

type PendingRead = { invalidated: boolean };

// Keep only the latest read for each key. A successful local write marks an
// overlapping read for a retry, so its older snapshot cannot undo the write.
async function readLatest<T>(
  pending: Map<string, PendingRead>,
  key: string,
  read: () => Promise<T>,
  apply: (data: T) => void,
): Promise<void> {
  const request: PendingRead = { invalidated: false };
  pending.set(key, request);
  try {
    for (;;) {
      request.invalidated = false;
      let data: T;
      try {
        data = await read();
      } catch (err) {
        if (pending.get(key) !== request) return;
        if (request.invalidated) continue;
        throw err;
      }
      if (pending.get(key) !== request) return;
      if (request.invalidated) continue;
      apply(data);
      return;
    }
  } finally {
    if (pending.get(key) === request) pending.delete(key);
  }
}

export type UseEntriesReturn = {
  entriesByDate: Record<string, EntryWithMacros[]>;
  weekTotals: Record<string, Macros>;
  loadedDates: Set<string>;
  load: (date: string) => Promise<void>;
  loadWeek: (start: string) => Promise<void>;
  invalidateReads: () => void;
  add: (params: {
    product_id: number;
    grams: number;
    local_date: string;
    local_time: string;
  }) => Promise<EntryWithMacros>;
  update: (id: number, patch: { grams?: number; tagged?: boolean }) => Promise<EntryWithMacros>;
  remove: (id: number, date: string) => Promise<void>;
  createGroup: (params: { name: string; entry_ids: number[] }) => Promise<EntryGroup>;
  renameGroup: (id: number, name: string) => Promise<EntryGroup>;
  toggleGroupTagged: (id: number, tagged: boolean) => Promise<EntryWithMacros[]>;
  ungroup: (id: number) => Promise<void>;
};

export function useEntries(): UseEntriesReturn {
  const [{ entriesByDate, weekTotals, loadedDates }, setCache] = useState<EntryCache>(() => ({
    entriesByDate: {},
    weekTotals: {},
    loadedDates: new Set(),
  }));
  const pendingDays = useRef(new Map<string, PendingRead>());
  const pendingWeeks = useRef(new Map<string, PendingRead>());

  const invalidateReads = useCallback(() => {
    for (const request of pendingDays.current.values()) request.invalidated = true;
    for (const request of pendingWeeks.current.values()) request.invalidated = true;
  }, []);

  const invalidateDateReads = useCallback((date: string, nutritionChanged = false) => {
    const day = pendingDays.current.get(date);
    if (day !== undefined) day.invalidated = true;
    if (!nutritionChanged) return;
    for (const [start, request] of pendingWeeks.current) {
      const end = new Date(`${start}T12:00:00`);
      end.setDate(end.getDate() + 7);
      if (date >= start && date < toLocalDateString(end)) request.invalidated = true;
    }
  }, []);

  const load = useCallback(async (date: string) => {
    await readLatest(
      pendingDays.current,
      date,
      () => api<EntryWithMacros[]>(`/entries?date=${encodeURIComponent(date)}`),
      (list) => setCache((prev) => ({
        ...updateCachedDay(prev, date, () => list),
        loadedDates: prev.loadedDates.has(date)
          ? prev.loadedDates
          : new Set(prev.loadedDates).add(date),
      })),
    );
  }, []);

  const loadWeek = useCallback(async (start: string) => {
    await readLatest(
      pendingWeeks.current,
      start,
      () => api<Record<string, Macros>>(`/entries/week?start=${encodeURIComponent(start)}`),
      (data) => setCache((prev) => ({ ...prev, weekTotals: { ...prev.weekTotals, ...data } })),
    );
  }, []);

  const add = useCallback(
    async (params: {
      product_id: number;
      grams: number;
      local_date: string;
      local_time: string;
    }) => {
      const created = await api<EntryWithMacros>('/entries', {
        method: 'POST',
        body: params,
      });
      invalidateDateReads(created.local_date, true);
      // Only derive totals for a day known to be loaded by this callback.
      // A partial cache must not replace a full-day total fetched by loadWeek.
      const deriveTotals = loadedDates.has(created.local_date);
      setCache((prev) => updateCachedDay(
        prev,
        created.local_date,
        // Entry ids are the server-assigned insertion sequence. Sorting also
        // keeps overlapping POST responses in the same order as a cold load.
        // A day refresh can already contain this id while its POST response
        // is still pending. Preserve that refreshed row instead of duplicating it.
        (list) => (list.some((entry) => entry.id === created.id)
          ? [...list]
          : [...list, created]).sort((a, b) => a.id - b.id),
        deriveTotals,
      ));
      return created;
    },
    [loadedDates, invalidateDateReads],
  );

  const update = useCallback(async (id: number, patch: { grams?: number; tagged?: boolean }) => {
    const updated = await api<EntryWithMacros>(`/entries/${id}`, {
      method: 'PATCH',
      body: patch,
    });
    invalidateDateReads(updated.local_date, patch.grams !== undefined);
    const deriveTotals = patch.grams !== undefined && loadedDates.has(updated.local_date);
    setCache((prev) => updateCachedDay(
      prev,
      updated.local_date,
      (list) => list.map((entry) => (entry.id === updated.id ? updated : entry)),
      deriveTotals,
    ));
    return updated;
  }, [loadedDates, invalidateDateReads]);

  const remove = useCallback(async (id: number, date: string) => {
    const result = await api<{ ok: true; dissolved_group_id: number | null }>(`/entries/${id}`, {
      method: 'DELETE',
    });
    invalidateDateReads(date, true);
    const deriveTotals = loadedDates.has(date);
    setCache((prev) => updateCachedDay(
      prev,
      date,
      (list) => list
        .filter((e) => e.id !== id)
        .map((e) =>
          result.dissolved_group_id !== null && e.group?.id === result.dissolved_group_id
            ? { ...e, group: null }
            : e,
        ),
      deriveTotals,
    ));
  }, [loadedDates, invalidateDateReads]);

  const createGroup = useCallback(async (params: { name: string; entry_ids: number[] }) => {
    const group = await api<EntryGroup>('/entries/groups', {
      method: 'POST',
      body: params,
    });
    invalidateDateReads(group.local_date);
    const memberIds = new Set(params.entry_ids);
    setCache((prev) => updateCachedDay(
      prev,
      group.local_date,
      (list) => list.map((entry) =>
        memberIds.has(entry.id)
          ? { ...entry, group: { id: group.id, name: group.name } }
          : entry,
      ),
    ));
    return group;
  }, [invalidateDateReads]);

  const renameGroup = useCallback(async (id: number, name: string) => {
    const group = await api<EntryGroup>(`/entries/groups/${id}`, {
      method: 'PATCH',
      body: { name },
    });
    invalidateDateReads(group.local_date);
    setCache((prev) => updateCachedDay(
      prev,
      group.local_date,
      (list) => list.map((entry) =>
        entry.group?.id === group.id
          ? { ...entry, group: { id: group.id, name: group.name } }
          : entry,
      ),
    ));
    return group;
  }, [invalidateDateReads]);

  const toggleGroupTagged = useCallback(async (id: number, tagged: boolean) => {
    const updated = await api<EntryWithMacros[]>(`/entries/groups/${id}/tagged`, {
      method: 'PATCH',
      body: { tagged },
    });
    const first = updated[0];
    if (first !== undefined) {
      invalidateDateReads(first.local_date);
      const byId = new Map(updated.map((entry) => [entry.id, entry]));
      setCache((prev) => updateCachedDay(
        prev,
        first.local_date,
        (list) => list.map(
          (entry) => byId.get(entry.id) ?? entry,
        ),
      ));
    }
    return updated;
  }, [invalidateDateReads]);

  const ungroup = useCallback(async (id: number) => {
    await api<{ ok: true }>(`/entries/groups/${id}`, { method: 'DELETE' });
    // The response carries no date; refresh any pending day snapshot that
    // could still contain the old group metadata. Nutrition is unchanged.
    for (const request of pendingDays.current.values()) request.invalidated = true;
    setCache((prev) => ({
      ...prev,
      entriesByDate: Object.fromEntries(
        Object.entries(prev.entriesByDate).map(([date, list]) => [
          date,
          list.map((entry) =>
            entry.group?.id === id ? { ...entry, group: null } : entry,
          ),
        ]),
      ),
    }));
  }, []);

  return {
    entriesByDate,
    weekTotals,
    loadedDates,
    load,
    loadWeek,
    invalidateReads,
    add,
    update,
    remove,
    createGroup,
    renameGroup,
    toggleGroupTagged,
    ungroup,
  };
}
