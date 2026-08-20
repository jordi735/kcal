// Owns the entries cache keyed by local_date; exposes CRUD helpers backed by /entries.

import { useCallback, useState } from 'preact/hooks';
import { sumMacros, type EntryGroup, type EntryWithMacros, type Macros } from '../types';
import { api } from '../api';

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
  const [entriesByDate, setEntriesByDate] = useState<Record<string, EntryWithMacros[]>>({});
  const [weekTotals, setWeekTotals] = useState<Record<string, Macros>>({});
  const [loadedDates, setLoadedDates] = useState<Set<string>>(() => new Set());

  const load = useCallback(async (date: string) => {
    const list = await api<EntryWithMacros[]>(`/entries?date=${encodeURIComponent(date)}`);
    setEntriesByDate((prev) => ({ ...prev, [date]: list }));
    setLoadedDates((prev) => {
      if (prev.has(date)) return prev;
      const next = new Set(prev);
      next.add(date);
      return next;
    });
  }, []);

  const loadWeek = useCallback(async (start: string) => {
    const data = await api<Record<string, Macros>>(
      `/entries/week?start=${encodeURIComponent(start)}`,
    );
    setWeekTotals((prev) => ({ ...prev, ...data }));
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
      let newList: EntryWithMacros[] = [];
      setEntriesByDate((prev) => {
        const list = prev[created.local_date] ?? [];
        // Entry ids are the server-assigned insertion sequence. Sorting also
        // keeps overlapping POST responses in the same order as a cold load.
        const next = [...list, created].sort((a, b) => a.id - b.id);
        newList = next;
        return { ...prev, [created.local_date]: next };
      });
      // Skip the optimistic week-total derive when the day's entries cache
      // hasn't loaded — `prev[date] ?? []` would clobber whatever full-day
      // total `loadWeek` already wrote with just the new entry's macros.
      if (loadedDates.has(created.local_date)) {
        setWeekTotals((prev) => ({ ...prev, [created.local_date]: sumMacros(newList) }));
      }
      return created;
    },
    [loadedDates],
  );

  const update = useCallback(async (id: number, patch: { grams?: number; tagged?: boolean }) => {
    const updated = await api<EntryWithMacros>(`/entries/${id}`, {
      method: 'PATCH',
      body: patch,
    });
    let newList: EntryWithMacros[] = [];
    setEntriesByDate((prev) => {
      const list = prev[updated.local_date] ?? [];
      const next = list.map((e) => (e.id === updated.id ? updated : e));
      newList = next;
      return {
        ...prev,
        [updated.local_date]: next,
      };
    });
    if (patch.grams !== undefined && loadedDates.has(updated.local_date)) {
      setWeekTotals((prev) => ({ ...prev, [updated.local_date]: sumMacros(newList) }));
    }
    return updated;
  }, [loadedDates]);

  const remove = useCallback(async (id: number, date: string) => {
    const result = await api<{ ok: true; dissolved_group_id: number | null }>(`/entries/${id}`, {
      method: 'DELETE',
    });
    let newList: EntryWithMacros[] = [];
    setEntriesByDate((prev) => {
      const list = prev[date] ?? [];
      const next = list
        .filter((e) => e.id !== id)
        .map((e) =>
          result.dissolved_group_id !== null && e.group?.id === result.dissolved_group_id
            ? { ...e, group: null }
            : e,
        );
      newList = next;
      return { ...prev, [date]: next };
    });
    if (loadedDates.has(date)) {
      setWeekTotals((prev) => ({ ...prev, [date]: sumMacros(newList) }));
    }
  }, [loadedDates]);

  const createGroup = useCallback(async (params: { name: string; entry_ids: number[] }) => {
    const group = await api<EntryGroup>('/entries/groups', {
      method: 'POST',
      body: params,
    });
    const memberIds = new Set(params.entry_ids);
    setEntriesByDate((prev) => {
      const list = prev[group.local_date] ?? [];
      return {
        ...prev,
        [group.local_date]: list.map((entry) =>
          memberIds.has(entry.id)
            ? { ...entry, group: { id: group.id, name: group.name } }
            : entry,
        ),
      };
    });
    return group;
  }, []);

  const renameGroup = useCallback(async (id: number, name: string) => {
    const group = await api<EntryGroup>(`/entries/groups/${id}`, {
      method: 'PATCH',
      body: { name },
    });
    setEntriesByDate((prev) => ({
      ...prev,
      [group.local_date]: (prev[group.local_date] ?? []).map((entry) =>
        entry.group?.id === group.id
          ? { ...entry, group: { id: group.id, name: group.name } }
          : entry,
      ),
    }));
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
      setEntriesByDate((prev) => ({
        ...prev,
        [first.local_date]: (prev[first.local_date] ?? []).map(
          (entry) => byId.get(entry.id) ?? entry,
        ),
      }));
    }
    return updated;
  }, []);

  const ungroup = useCallback(async (id: number) => {
    await api<{ ok: true }>(`/entries/groups/${id}`, { method: 'DELETE' });
    setEntriesByDate((prev) =>
      Object.fromEntries(
        Object.entries(prev).map(([date, list]) => [
          date,
          list.map((entry) =>
            entry.group?.id === id ? { ...entry, group: null } : entry,
          ),
        ]),
      ),
    );
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
