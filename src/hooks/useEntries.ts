// Owns the entries cache keyed by local_date; exposes CRUD helpers backed by /entries.

import { useCallback, useState } from 'preact/hooks';
import { sumMacros, type EntryWithMacros, type Macros } from '../types';
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
  update: (id: number, grams: number) => Promise<EntryWithMacros>;
  remove: (id: number, date: string) => Promise<void>;
};

type WeekResponse = Record<string, { consumed: Macros; entry_count: number }>;

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
    const data = await api<WeekResponse>(`/entries/week?start=${encodeURIComponent(start)}`);
    const next: Record<string, Macros> = {};
    for (const [date, dt] of Object.entries(data)) {
      next[date] = dt.consumed;
    }
    setWeekTotals((prev) => ({ ...prev, ...next }));
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
        // Preserve local_time ASC ordering on insertion.
        const next = [...list, created].sort((a, b) =>
          a.local_time < b.local_time
            ? -1
            : a.local_time > b.local_time
              ? 1
              : a.id - b.id,
        );
        newList = next;
        return { ...prev, [created.local_date]: next };
      });
      setWeekTotals((prev) => ({ ...prev, [created.local_date]: sumMacros(newList) }));
      return created;
    },
    [],
  );

  const update = useCallback(async (id: number, grams: number) => {
    const updated = await api<EntryWithMacros>(`/entries/${id}`, {
      method: 'PATCH',
      body: { grams },
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
    setWeekTotals((prev) => ({ ...prev, [updated.local_date]: sumMacros(newList) }));
    return updated;
  }, []);

  const remove = useCallback(async (id: number, date: string) => {
    await api<{ ok: true }>(`/entries/${id}`, { method: 'DELETE' });
    let newList: EntryWithMacros[] = [];
    setEntriesByDate((prev) => {
      const list = prev[date] ?? [];
      const next = list.filter((e) => e.id !== id);
      newList = next;
      return { ...prev, [date]: next };
    });
    setWeekTotals((prev) => ({ ...prev, [date]: sumMacros(newList) }));
  }, []);

  return { entriesByDate, weekTotals, loadedDates, load, loadWeek, add, update, remove };
}
