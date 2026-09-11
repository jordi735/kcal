// Owns the entries cache keyed by local_date; exposes CRUD helpers backed by /entries.

import { useCallback, useState } from 'preact/hooks';
import type { EntryGroup, EntryWithMacros, Macros } from '../types';
import { api } from '../api';
import { updateCachedDay, type EntryCache } from './entryCache';

export type UseEntriesReturn = {
  entriesByDate: Record<string, EntryWithMacros[]>;
  weekTotals: Record<string, Macros>;
  loadedDates: Set<string>;
  load: (date: string) => Promise<void>;
  loadWeek: (start: string) => Promise<void>;
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

  const load = useCallback(async (date: string) => {
    const list = await api<EntryWithMacros[]>(`/entries?date=${encodeURIComponent(date)}`);
    setCache((prev) => ({
      ...updateCachedDay(prev, date, () => list),
      loadedDates: prev.loadedDates.has(date)
        ? prev.loadedDates
        : new Set(prev.loadedDates).add(date),
    }));
  }, []);

  const loadWeek = useCallback(async (start: string) => {
    const data = await api<Record<string, Macros>>(
      `/entries/week?start=${encodeURIComponent(start)}`,
    );
    setCache((prev) => ({ ...prev, weekTotals: { ...prev.weekTotals, ...data } }));
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
      // Only derive totals for a day known to be loaded by this callback.
      // A partial cache must not replace a full-day total fetched by loadWeek.
      const deriveTotals = loadedDates.has(created.local_date);
      setCache((prev) => updateCachedDay(
        prev,
        created.local_date,
        // Entry ids are the server-assigned insertion sequence. Sorting also
        // keeps overlapping POST responses in the same order as a cold load.
        (list) => [...list, created].sort((a, b) => a.id - b.id),
        deriveTotals,
      ));
      return created;
    },
    [loadedDates],
  );

  const update = useCallback(async (id: number, patch: { grams?: number; tagged?: boolean }) => {
    const updated = await api<EntryWithMacros>(`/entries/${id}`, {
      method: 'PATCH',
      body: patch,
    });
    const deriveTotals = patch.grams !== undefined && loadedDates.has(updated.local_date);
    setCache((prev) => updateCachedDay(
      prev,
      updated.local_date,
      (list) => list.map((entry) => (entry.id === updated.id ? updated : entry)),
      deriveTotals,
    ));
    return updated;
  }, [loadedDates]);

  const remove = useCallback(async (id: number, date: string) => {
    const result = await api<{ ok: true; dissolved_group_id: number | null }>(`/entries/${id}`, {
      method: 'DELETE',
    });
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
  }, [loadedDates]);

  const createGroup = useCallback(async (params: { name: string; entry_ids: number[] }) => {
    const group = await api<EntryGroup>('/entries/groups', {
      method: 'POST',
      body: params,
    });
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
  }, []);

  const renameGroup = useCallback(async (id: number, name: string) => {
    const group = await api<EntryGroup>(`/entries/groups/${id}`, {
      method: 'PATCH',
      body: { name },
    });
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
  }, []);

  const toggleGroupTagged = useCallback(async (id: number, tagged: boolean) => {
    const updated = await api<EntryWithMacros[]>(`/entries/groups/${id}/tagged`, {
      method: 'PATCH',
      body: { tagged },
    });
    const first = updated[0];
    if (first !== undefined) {
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
  }, []);

  const ungroup = useCallback(async (id: number) => {
    await api<{ ok: true }>(`/entries/groups/${id}`, { method: 'DELETE' });
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
    add,
    update,
    remove,
    createGroup,
    renameGroup,
    toggleGroupTagged,
    ungroup,
  };
}
