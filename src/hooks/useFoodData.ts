// Account-owned food cache. Writes are ordered across entries, groups and products.
import { useCallback, useRef, useState } from 'preact/hooks';
import type { EntryGroup, EntryUpdate, EntryWithMacros, Macros, NewEntryBody, NewProductBody, Product, UpdateProductBody } from '../types';
import { api, isSessionCurrent, type SessionScope } from '../api';
import { datesFromStart } from '../../shared/dates';
import { toLocalDateString } from '../dates';
import { createMutationQueue } from '../mutationQueue';
import { removeCachedProduct, updateCachedDay, updateCachedProduct, type EntryCache } from './entryCache';

export type FoodViewWindow = { selectedDate: string; today: string; weekStart: string };

type PendingRead = { invalidated: boolean };
async function readLatest<T>(pending: Map<string, PendingRead>, key: string,
  read: () => Promise<T>, apply: (data: T) => void): Promise<void> {
  const request: PendingRead = { invalidated: false };
  pending.set(key, request);
  try {
    for (;;) {
      request.invalidated = false;
      let data: T;
      try { data = await read(); }
      catch (err) {
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

export type UseFoodDataReturn = {
  entriesByDate: Record<string, EntryWithMacros[]>;
  weekTotals: Record<string, Macros>;
  loadedDates: Set<string>;
  load: (date: string) => Promise<void>;
  loadWeek: (start: string) => Promise<void>;
  createProduct: (body: NewProductBody) => Promise<Product>;
  adoptProduct: (sourceId: number) => Promise<Product>;
  updateProduct: (id: number, body: UpdateProductBody) => Promise<Product>;
  deleteProduct: (id: number) => Promise<void>;
  add: (params: NewEntryBody) => Promise<EntryWithMacros>;
  update: (id: number, patch: EntryUpdate) => Promise<EntryWithMacros>;
  remove: (id: number, date: string) => Promise<void>;
  createGroup: (params: { name: string; entry_ids: number[] }) => Promise<EntryGroup>;
  renameGroup: (id: number, name: string) => Promise<EntryGroup>;
  toggleGroupTagged: (id: number, tagged: boolean) => Promise<EntryWithMacros[]>;
  ungroup: (id: number) => Promise<void>;
};

export function useFoodData(session: SessionScope, onRefreshError: () => void, view: FoodViewWindow): UseFoodDataReturn {
  const [cache, setCache] = useState<EntryCache>(() => ({ entriesByDate: {}, weekTotals: {}, loadedDates: new Set() }));
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  const { entriesByDate, weekTotals, loadedDates } = cache;
  const pendingDays = useRef(new Map<string, PendingRead>());
  const pendingWeeks = useRef(new Map<string, PendingRead>());
  const knownWeeks = useRef(new Set<string>());
  const appliedReadVersion = useRef(0);
  const lastAppliedDayReadVersion = useRef(new Map<string, number>());
  const activeWindow = useRef(view);
  activeWindow.current = view;
  const queue = useRef(createMutationQueue(session)).current;
  const refreshError = useRef(onRefreshError);
  refreshError.current = onRefreshError;
  const changeCache = useCallback((update: (previous: EntryCache) => EntryCache) => {
    setCache((previous) => {
      const next = update(previous);
      cacheRef.current = next;
      return next;
    });
  }, []);

  const retireReads = useCallback(() => {
    // Superseded responses neither apply nor retry. Invalidating every old
    // request instead would restart off-screen history reads as they settle.
    pendingDays.current.clear();
    pendingWeeks.current.clear();
  }, []);
  const weekIncludes = (start: string, date: string) => {
    const last = datesFromStart(start, 7)[6]!;
    return date >= start && date <= last;
  };
  const invalidateDateReads = useCallback((date: string, nutritionChanged = false) => {
    const day = pendingDays.current.get(date);
    if (day !== undefined) day.invalidated = true;
    if (nutritionChanged) for (const [start, request] of pendingWeeks.current) {
      if (weekIncludes(start, date)) request.invalidated = true;
    }
  }, []);

  const load = useCallback((date: string) => readLatest(
    pendingDays.current, date,
    () => api<EntryWithMacros[]>(`/entries?date=${encodeURIComponent(date)}`, { session }),
    (list) => {
      appliedReadVersion.current++;
      lastAppliedDayReadVersion.current.set(date, appliedReadVersion.current);
      changeCache((previous) => ({
        ...updateCachedDay(previous, date, () => list),
        loadedDates: previous.loadedDates.has(date) ? previous.loadedDates : new Set(previous.loadedDates).add(date),
      }));
    },
  ), [session, changeCache]);
  const loadWeek = useCallback((start: string) => {
    knownWeeks.current.add(start);
    return readLatest(pendingWeeks.current, start,
      () => api<Record<string, Macros>>(`/entries/week?start=${encodeURIComponent(start)}`, { session }),
      (data) => {
        appliedReadVersion.current++;
        changeCache((previous) => ({ ...previous, weekTotals: { ...previous.weekTotals, ...data } }));
      });
  }, [session, changeCache]);

  const reconcile = useCallback(async (dates: string[], nutritionChanged = true) => {
    const unique = [...new Set(dates)];
    const weeks = nutritionChanged ? [...knownWeeks.current].filter((start) => unique.some((date) => weekIncludes(start, date))) : [];
    const results = await Promise.allSettled([...unique.map(load), ...weeks.map(loadWeek)]);
    // The write already committed. A failed refresh must not turn it into a
    // failed create/group operation that the user might accidentally retry.
    if (results.some((result) => result.status === 'rejected') && isSessionCurrent(session)) refreshError.current();
  }, [load, loadWeek, session]);
  const refreshActiveWindow = useCallback(async () => {
    // Freeze the latest rendered view at commit. Navigation continues to own
    // its normal reads without extending this queued operation indefinitely.
    const { selectedDate, today, weekStart } = activeWindow.current;
    const dates = [...new Set([selectedDate, today])];
    const weeks = [-7, 0, 7].map((offset) => {
      const monday = new Date(`${weekStart}T12:00:00`);
      monday.setDate(monday.getDate() + offset);
      return toLocalDateString(monday);
    });
    const results = await Promise.allSettled([...dates.map(load), ...weeks.map(loadWeek)]);
    if (results.some((result) => result.status === 'rejected') && isSessionCurrent(session)) refreshError.current();
  }, [load, loadWeek, session]);

  const createProduct = useCallback((body: NewProductBody) => queue(() =>
    api<Product>('/products', { method: 'POST', body, session }),
  ), [queue, session]);

  const adoptProduct = useCallback((sourceId: number) => queue(() =>
    api<Product>(`/products/adopt/${sourceId}`, { method: 'POST', session }),
  ), [queue, session]);

  const updateProduct = useCallback((id: number, body: UpdateProductBody) => {
    const loaded = loadedDates;
    return queue(async () => {
      const readVersion = appliedReadVersion.current;
      const product = await api<Product>(`/products/${id}`, { method: 'PUT', body, session });
      const protectedDates = new Set([...lastAppliedDayReadVersion.current]
        .filter(([, version]) => version > readVersion).map(([date]) => date));
      // Even an unrelated accepted read can contain a newer weekly summary.
      // Prefer revalidation over deriving that total from an older day cache.
      const totalDates = readVersion === appliedReadVersion.current ? loaded : new Set<string>();
      retireReads();
      changeCache((previous) => updateCachedProduct(previous, product, protectedDates, totalDates));
      await refreshActiveWindow();
      return product;
    });
  }, [loadedDates, queue, session, retireReads, changeCache, refreshActiveWindow]);

  const deleteProduct = useCallback((id: number) => {
    const loaded = loadedDates;
    return queue(async () => {
      const readVersion = appliedReadVersion.current;
      await api<{ ok: true }>(`/products/${id}`, { method: 'DELETE', session });
      const totalDates = readVersion === appliedReadVersion.current ? loaded : new Set<string>();
      retireReads();
      changeCache((previous) => removeCachedProduct(previous, id, totalDates));
      await refreshActiveWindow();
    });
  }, [loadedDates, queue, session, retireReads, changeCache, refreshActiveWindow]);

  const add = useCallback((params: NewEntryBody) => {
    const deriveTotals = loadedDates.has(params.local_date);
    return queue(async () => {
      const readVersion = appliedReadVersion.current;
      const created = await api<EntryWithMacros>('/entries', { method: 'POST', body: params, session });
      invalidateDateReads(created.local_date, true);
      if (readVersion !== appliedReadVersion.current) await reconcile([created.local_date]);
      else changeCache((previous) => updateCachedDay(previous, created.local_date,
        (list) => (list.some((entry) => entry.id === created.id) ? [...list] : [...list, created]).sort((a, b) => a.id - b.id), deriveTotals));
      return created;
    });
  }, [loadedDates, queue, session, invalidateDateReads, reconcile, changeCache]);

  const update = useCallback((id: number, patch: EntryUpdate) => {
    const loaded = loadedDates;
    const nutritionChanged = patch.amount !== undefined || patch.product_id !== undefined;
    return queue(async () => {
      const readVersion = appliedReadVersion.current;
      const updated = await api<EntryWithMacros>(`/entries/${id}`, { method: 'PATCH', body: patch, session });
      invalidateDateReads(updated.local_date, nutritionChanged);
      if (readVersion !== appliedReadVersion.current) await reconcile([updated.local_date], nutritionChanged);
      else changeCache((previous) => updateCachedDay(previous, updated.local_date,
        (list) => list.map((entry) => entry.id === updated.id ? updated : entry), nutritionChanged && loaded.has(updated.local_date)));
      return updated;
    });
  }, [loadedDates, queue, session, invalidateDateReads, reconcile, changeCache]);

  const remove = useCallback((id: number, date: string) => {
    const deriveTotals = loadedDates.has(date);
    return queue(async () => {
      const readVersion = appliedReadVersion.current;
      const result = await api<{ ok: true; dissolved_group_id: number | null }>(`/entries/${id}`, { method: 'DELETE', session });
      invalidateDateReads(date, true);
      if (readVersion !== appliedReadVersion.current) await reconcile([date]);
      else changeCache((previous) => updateCachedDay(previous, date,
        (list) => list.filter((entry) => entry.id !== id).map((entry) => result.dissolved_group_id !== null && entry.group?.id === result.dissolved_group_id
          ? { ...entry, group: null } : entry), deriveTotals));
    });
  }, [loadedDates, queue, session, invalidateDateReads, reconcile, changeCache]);

  const createGroup = useCallback((params: { name: string; entry_ids: number[] }) => queue(async () => {
    const readVersion = appliedReadVersion.current;
    const group = await api<EntryGroup>('/entries/groups', { method: 'POST', body: params, session });
    invalidateDateReads(group.local_date);
    if (readVersion !== appliedReadVersion.current) await reconcile([group.local_date], false);
    else {
      const ids = new Set(params.entry_ids);
      changeCache((previous) => updateCachedDay(previous, group.local_date,
        (list) => list.map((entry) => ids.has(entry.id) ? { ...entry, group: { id: group.id, name: group.name } } : entry)));
    }
    return group;
  }), [queue, session, invalidateDateReads, reconcile, changeCache]);

  const renameGroup = useCallback((id: number, name: string) => queue(async () => {
    const readVersion = appliedReadVersion.current;
    const group = await api<EntryGroup>(`/entries/groups/${id}`, { method: 'PATCH', body: { name }, session });
    invalidateDateReads(group.local_date);
    if (readVersion !== appliedReadVersion.current) await reconcile([group.local_date], false);
    else changeCache((previous) => updateCachedDay(previous, group.local_date,
      (list) => list.map((entry) => entry.group?.id === group.id ? { ...entry, group: { id: group.id, name: group.name } } : entry)));
    return group;
  }), [queue, session, invalidateDateReads, reconcile, changeCache]);

  const toggleGroupTagged = useCallback((id: number, tagged: boolean) => queue(async () => {
    const readVersion = appliedReadVersion.current;
    const updated = await api<EntryWithMacros[]>(`/entries/groups/${id}/tagged`, { method: 'PATCH', body: { tagged }, session });
    const first = updated[0];
    if (first !== undefined) {
      invalidateDateReads(first.local_date);
      if (readVersion !== appliedReadVersion.current) await reconcile([first.local_date]);
      else {
        const byId = new Map(updated.map((entry) => [entry.id, entry]));
        changeCache((previous) => updateCachedDay(previous, first.local_date,
          (list) => list.map((entry) => byId.get(entry.id) ?? entry)));
      }
    }
    return updated;
  }), [queue, session, invalidateDateReads, reconcile, changeCache]);

  const ungroup = useCallback((id: number) => queue(async () => {
    const readVersion = appliedReadVersion.current;
    await api<{ ok: true }>(`/entries/groups/${id}`, { method: 'DELETE', session });
    for (const request of pendingDays.current.values()) request.invalidated = true;
    if (readVersion !== appliedReadVersion.current) await reconcile([...cacheRef.current.loadedDates], false);
    else changeCache((previous) => ({ ...previous, entriesByDate: Object.fromEntries(
      Object.entries(previous.entriesByDate).map(([date, list]) => [date, list.map((entry) => entry.group?.id === id ? { ...entry, group: null } : entry)]),
    ) }));
  }), [queue, session, reconcile, changeCache]);

  return { entriesByDate, weekTotals, loadedDates, load, loadWeek,
    createProduct, adoptProduct, updateProduct, deleteProduct,
    add, update, remove, createGroup, renameGroup, toggleGroupTagged, ungroup };
}
