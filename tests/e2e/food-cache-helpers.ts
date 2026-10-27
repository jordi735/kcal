import { expect, type Page, type Request } from '@playwright/test';
import type { EntryUpdate, EntryWithMacros, Macros, Product, User } from '../../src/types';
import { computeMacros, sumMacros } from '../../src/macros';
import { isApiPath } from '../../shared/apiPrefixes';
import { datesFromStart } from '../../shared/dates';
import { deferred, frame, readCycle } from './app-refresh-helpers';
import { fillNutField } from './helpers';

export const TODAY = '2030-01-07';
export const HISTORY = '2029-12-10';
export const GOALS: Macros = { kcal: 1000, protein: 100, carbs: 200, fat: 50 };
export const ORIGINAL: Product = { id: 1, name: 'Cache food', brand: 'Original brand', unit: 'g', barcode: null,
  is_temp: false, per100: { kcal: 100, protein: 10, carbs: 10, fat: 2 } };
export const OTHER: Product = { ...ORIGINAL, id: 2, name: 'Other food', brand: null,
  per100: { kcal: 50, protein: 5, carbs: 5, fat: 1 } };

export function offsetDate(date: string, days: number) {
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

export function food(date: string, product = ORIGINAL, index = 1, group: EntryWithMacros['group'] = null): EntryWithMacros {
  return { id: Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000) * 10 + index,
    product: structuredClone(product), amount: 100, local_date: date, local_time: '12:34',
    macros: computeMacros(product, 100), tagged: false, group };
}

type Gate = ReturnType<typeof deferred>;
export type RequestLog = {
  method: string; path: string; kind: 'day' | 'week' | 'other'; key: string;
  finished: Gate; request: Request;
};
export type ReadHold = {
  kind: 'day' | 'week'; key: string; remaining: number;
  started: Gate; release: Gate; records: RequestLog[];
  status?: number;
};
type WriteHold = { started: Gate; release: Gate; records: RequestLog[] };

export type FoodState = {
  page: Page;
  products: Map<number, Product>;
  rows: Map<string, EntryWithMacros[]>;
  requests: RequestLog[];
  holds: ReadHold[];
  writeHold: WriteHold | null;
  failEntryReads: boolean;
  failReadsAfterWrite: boolean;
  nextProductError: boolean;
  unexpected: string[];
  daySnapshot: ((date: string, rows: EntryWithMacros[]) => EntryWithMacros[]) | null;
  getRows: (date: string) => EntryWithMacros[];
  replaceProduct: (product: Product) => void;
  releaseAll: () => void;
};

export async function bootFood(page: Page) {
  const state: FoodState = {
    page, products: new Map([[1, structuredClone(ORIGINAL)], [2, structuredClone(OTHER)]]), rows: new Map(),
    requests: [], holds: [], writeHold: null, failEntryReads: false, failReadsAfterWrite: false,
    nextProductError: false, unexpected: [], daySnapshot: null,
    getRows(date) {
      let rows = state.rows.get(date);
      if (rows === undefined) {
        const product = state.products.get(1);
        rows = product === undefined ? [] : [food(date, product)];
        state.rows.set(date, rows);
      }
      return rows;
    },
    replaceProduct(product) {
      state.products.set(product.id, product);
      for (const [date, rows] of state.rows) state.rows.set(date, rows.map(row => row.product.id === product.id
        ? { ...row, product, macros: computeMacros(product, row.amount) } : row));
    },
    releaseAll() {
      state.writeHold?.release.resolve();
      for (const hold of state.holds) { hold.remaining = 0; hold.release.resolve(); }
    },
  };
  const user: User = { id: 1, email: 'food-cache@test.local', goal_kcal: GOALS.kcal,
    goal_protein: GOALS.protein, goal_carbs: GOALS.carbs, goal_fat: GOALS.fat };
  await page.clock.setFixedTime(new Date(`${TODAY}T12:00:00Z`));
  await page.addInitScript(cached => {
    localStorage.setItem('kcal_session_token', 'food-cache-mock');
    localStorage.setItem('kcal_user', JSON.stringify(cached));
  }, user);
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!isApiPath(url.pathname)) return route.fallback();
    const method = request.method();
    const kind = method === 'GET' && url.pathname === '/entries' ? 'day'
      : method === 'GET' && url.pathname === '/entries/week' ? 'week' : 'other';
    const record: RequestLog = { method, path: url.pathname + url.search, kind,
      key: kind === 'day' ? url.searchParams.get('date')! : kind === 'week' ? url.searchParams.get('start')! : '',
      finished: deferred(), request };
    state.requests.push(record);
    const respond = async (json: unknown, status = 200) => {
      const finished = page.waitForEvent('requestfinished', candidate => candidate === request);
      await route.fulfill({ status, json });
      await finished;
      record.finished.resolve();
    };
    if (kind === 'day' || kind === 'week') {
      const json = structuredClone(kind === 'day'
        ? state.daySnapshot?.(record.key, state.getRows(record.key)) ?? state.getRows(record.key)
        : Object.fromEntries(datesFromStart(record.key, 7).map(date => [date, sumMacros(state.getRows(date))])));
      const fail = state.failEntryReads;
      const hold = state.holds.find(candidate => candidate.kind === kind && candidate.key === record.key && candidate.remaining > 0);
      if (hold !== undefined) {
        hold.remaining--;
        hold.records.push(record);
        hold.started.resolve();
        await hold.release.promise;
      }
      return respond(fail || hold?.status !== undefined ? { error: 'refresh_unavailable' } : json,
        fail ? 503 : hold?.status ?? 200);
    }
    if (method === 'GET' && url.pathname === '/settings') return respond({ ...GOALS,
      goal_history: [{ effective_date: '2020-01-01', goals: GOALS }], mcp_notice_version: null });
    if (method === 'GET' && url.pathname === '/entries/recent-amounts') return respond({ amounts: [100] });
    if (method === 'GET' && ['/products/recent', '/products/all', '/products/search'].includes(url.pathname)) {
      return respond([...state.products.values()]);
    }
    const productId = /^\/products\/(\d+)$/.exec(url.pathname)?.[1];
    if (productId !== undefined && (method === 'PUT' || method === 'DELETE')) {
      if (state.nextProductError) { state.nextProductError = false; return respond({ error: 'product_unavailable' }, 503); }
      const id = Number(productId);
      let result: unknown;
      if (method === 'PUT') {
        const product = { ...state.products.get(id)!, ...request.postDataJSON() } as Product;
        state.replaceProduct(product);
        result = product;
      } else {
        state.products.delete(id);
        for (const [date, rows] of state.rows) {
          const kept = rows.filter(row => row.product.id !== id);
          const counts = new Map<number, number>();
          for (const row of kept) if (row.group !== null) counts.set(row.group.id, (counts.get(row.group.id) ?? 0) + 1);
          state.rows.set(date, kept.map(row => row.group !== null && counts.get(row.group.id)! < 2 ? { ...row, group: null } : row));
        }
        result = { ok: true };
      }
      const snapshot = structuredClone(result);
      if (state.failReadsAfterWrite) state.failEntryReads = true;
      if (state.writeHold !== null) {
        state.writeHold.records.push(record);
        state.writeHold.started.resolve();
        await state.writeHold.release.promise;
      }
      return respond(snapshot);
    }
    const entryId = /^\/entries\/(\d+)$/.exec(url.pathname)?.[1];
    if (entryId !== undefined && method === 'PATCH') {
      const patch = request.postDataJSON() as EntryUpdate;
      for (const [date, rows] of state.rows) {
        const previous = rows.find(row => row.id === Number(entryId));
        if (previous === undefined) continue;
        const product = patch.product_id === undefined ? previous.product : state.products.get(patch.product_id)!;
        const updated = { ...previous, ...patch, product, macros: computeMacros(product, patch.amount ?? previous.amount) };
        state.rows.set(date, rows.map(row => row.id === updated.id ? updated : row));
        return respond(updated);
      }
    }
    state.unexpected.push(`${method} ${url.pathname}`);
    return respond({ error: 'unexpected_mock_request' }, 503);
  });
  await readCycle(page, () => page.goto('/'));
  await expect(page.locator('.food-row')).toContainText(ORIGINAL.name);
  return state;
}

export function holdRead(state: FoodState, kind: 'day' | 'week', key: string, remaining = 1, status?: number) {
  const hold: ReadHold = { kind, key, remaining, started: deferred(), release: deferred(), records: [],
    ...(status === undefined ? {} : { status }) };
  state.holds.push(hold);
  return hold;
}

export function holdProductWrite(state: FoodState) {
  const hold: WriteHold = { started: deferred(), release: deferred(), records: [] };
  state.writeHold = hold;
  return hold;
}

export async function releaseHold(page: Page, hold: ReadHold | WriteHold) {
  if ('remaining' in hold) hold.remaining = 0;
  hold.release.resolve();
  await Promise.all(hold.records.map(record => record.finished.promise));
  await frame(page);
}

export async function shiftWeek(page: Page, direction: -1 | 1) {
  const arrows = weekArrows(page);
  await expect(arrows).toHaveCount(2);
  await readCycle(page, () => arrows.nth(direction === -1 ? 0 : 1).tap(), 3);
}

export async function shiftWeeks(page: Page, count: number) {
  for (let i = 0; i < Math.abs(count); i++) await shiftWeek(page, count < 0 ? -1 : 1);
}

export async function selectMonday(page: Page, today = false) {
  await readCycle(page, () => centerMonday(page).tap(), today ? 1 : 2);
}

export async function openProduct(page: Page) {
  await page.locator('.food-row').first().getByRole('button').last().tap();
  await expect(page.locator('.sheet').getByText('Edit entry', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit product', exact: true }).tap();
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeVisible();
}

export async function submitProduct(page: Page, name = 'Edited cache food', kcal = '200') {
  await page.getByPlaceholder('e.g. Peanut Butter', { exact: true }).fill(name);
  await fillNutField(page, 'Kcal', kcal);
  await page.getByRole('button', { name: 'Save changes', exact: true }).tap();
}

export async function deleteProduct(page: Page) {
  await page.getByRole('button', { name: 'Delete product', exact: true }).tap();
  await page.getByRole('button', { name: 'Confirm delete', exact: true }).tap();
}

export async function dismiss(page: Page) {
  await page.locator('.overlay').dispatchEvent('click');
  await expect(page.locator('.sheet')).toHaveCount(0);
}

export function entryReads(state: FoodState, start = 0) {
  return state.requests.slice(start).filter(record => record.kind === 'day' || record.kind === 'week');
}

export function windowPaths(selected: string, monday: string) {
  return [...new Set([selected, TODAY])].map(date => `/entries?date=${date}`)
    .concat([-7, 0, 7].map(offset => `/entries/week?start=${offsetDate(monday, offset)}`)).sort();
}

export async function expectReadWindow(state: FoodState, start: number, selected: string, monday: string) {
  const expected = windowPaths(selected, monday);
  await expect.poll(() => entryReads(state, start).map(record => record.path).sort()).toEqual(expected);
  await Promise.all(entryReads(state, start).map(record => record.finished.promise));
  await frame(state.page);
  expect(entryReads(state, start).map(record => record.path).sort()).toEqual(expected);
}

export const consumed = (page: Page) => page.getByText('Consumed', { exact: true }).locator('..');
const weekArrows = (page: Page) => page.getByText(/· W\d{2}$/).locator('..').getByRole('button', { name: '', exact: true });
const centerMonday = (page: Page) => page.getByRole('button', { name: /^M \d{1,2}$/ }).nth(1);
export const mondayDot = (page: Page) => centerMonday(page).locator('[style*="--dot-opacity"]');

// Await actual dispatched/completed requests, leaving explicitly deferred
// responses pending so race tests need no wall-clock sleeps.
export async function readAction(state: FoodState, action: () => Promise<unknown>, expected: number) {
  const start = state.requests.length;
  await action();
  await expect.poll(() => entryReads(state, start).length).toBe(expected);
  const held = new Set(state.holds.flatMap(hold => hold.records));
  await Promise.all(entryReads(state, start).filter(record => !held.has(record)).map(record => record.finished.promise));
  await frame(state.page);
  return entryReads(state, start);
}

export async function shiftWithHeldReads(state: FoodState, count: number) {
  for (let i = 0; i < Math.abs(count); i++) {
    const arrows = weekArrows(state.page);
    await expect(arrows).toHaveCount(2);
    await readAction(state, () => arrows.nth(count < 0 ? 0 : 1).tap(), 3);
  }
}

export async function selectMondayWithHeldReads(state: FoodState, today = false) {
  await readAction(state, () => centerMonday(state.page).tap(), today ? 1 : 2);
}

export async function finishFood(state: FoodState) {
  state.releaseAll();
  await Promise.all(state.requests.map(record => record.finished.promise));
  await frame(state.page);
  await Promise.all(state.requests.map(record => record.finished.promise));
}
