// GET /entries, GET /entries/recent-grams, GET /entries/week,
// POST /entries, PATCH /entries/:id, DELETE /entries/:id.
// Macros computed on read; never stored. Every query scoped by req.userId.

import { Router } from 'express';
import { authMiddleware } from '../auth.js';
import { DATE_RE, TIME_RE, isObject, isPositiveFinite, isPositiveInt } from '../guards.js';
import { log } from '../log.js';
import { statements } from '../statements.js';
import { parsePositiveInt } from '../util.js';
import type {
  EntryJoinRow,
  EntryWithMacros,
  NewEntryBody,
  WeekSumRow,
} from '../types.js';

export const entriesRouter: Router = Router();

entriesRouter.use(authMiddleware);

function rowToEntry(r: EntryJoinRow): EntryWithMacros {
  const f = r.grams / 100;
  return {
    id: r.id,
    product: {
      id: r.p_id,
      name: r.p_name,
      brand: r.p_brand,
      unit: r.p_unit === 'ml' ? 'ml' : 'g',
      barcode: r.p_barcode,
      per100: {
        kcal: r.p_kcal_per100,
        protein: r.p_protein_per100,
        carbs: r.p_carbs_per100,
        fat: r.p_fat_per100,
      },
      is_temp: r.p_is_temp === 1,
    },
    grams: r.grams,
    local_date: r.local_date,
    local_time: r.local_time,
    macros: {
      kcal: r.p_kcal_per100 * f,
      protein: r.p_protein_per100 * f,
      carbs: r.p_carbs_per100 * f,
      fat: r.p_fat_per100 * f,
    },
    tagged: r.tagged === 1,
  };
}

function isNewEntryBody(v: unknown): v is NewEntryBody {
  if (!isObject(v)) return false;
  return (
    isPositiveInt(v.product_id) &&
    isPositiveFinite(v.grams) &&
    typeof v.local_date === 'string' && DATE_RE.test(v.local_date) &&
    typeof v.local_time === 'string' && TIME_RE.test(v.local_time)
  );
}

function isUpdateEntryBody(v: unknown): v is { grams?: number; tagged?: boolean } {
  if (!isObject(v)) return false;
  if ('grams' in v && !isPositiveFinite(v.grams)) return false;
  if ('tagged' in v && typeof v.tagged !== 'boolean') return false;
  if (!('grams' in v) && !('tagged' in v)) return false;
  return true;
}

function sevenDatesFromStart(start: string): string[] {
  const [y, m, d] = start.split('-').map(Number) as [number, number, number];
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const dt = new Date(y, m - 1, d + i);
    const yy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    out.push(`${yy}-${mm}-${dd}`);
  }
  return out;
}

entriesRouter.get('/', (req, res) => {
  const rawDate = req.query.date;
  const date = typeof rawDate === 'string' ? rawDate : '';
  if (!DATE_RE.test(date)) {
    res.status(400).json({ error: 'invalid_date' });
    return;
  }
  const rows = statements.entries.selectForDay.all(req.userId!, date) as EntryJoinRow[];
  res.json(rows.map(rowToEntry));
});

// Declared before `/:id` routes so the string literal wins over any
// future id-shaped path. Current routes don't conflict, but this is cheap
// insurance.
entriesRouter.get('/recent-grams', (req, res) => {
  const rawId = req.query.product_id;
  const productId = typeof rawId === 'string' ? parsePositiveInt(rawId) : null;
  if (productId === null) {
    res.status(400).json({ error: 'invalid_product_id' });
    return;
  }
  const rows = statements.entries.recentGrams.all(req.userId!, productId) as { grams: number }[];
  res.json({ grams: rows.map((r) => r.grams) });
});

entriesRouter.get('/week', (req, res) => {
  const rawStart = req.query.start;
  const start = typeof rawStart === 'string' ? rawStart : '';
  if (!DATE_RE.test(start)) {
    res.status(400).json({ error: 'invalid_date' });
    return;
  }
  const dates = sevenDatesFromStart(start);
  const rows = statements.entries.weekSum.all(req.userId!, start, dates[6]!) as WeekSumRow[];
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const result = Object.fromEntries(
    dates.map((d) => {
      const r = byDate.get(d);
      return [
        d,
        r === undefined
          ? { kcal: 0, protein: 0, carbs: 0, fat: 0 }
          : { kcal: r.kcal, protein: r.protein, carbs: r.carbs, fat: r.fat },
      ];
    }),
  );
  res.json(result);
});

entriesRouter.post('/', (req, res) => {
  if (!isNewEntryBody(req.body)) {
    res.status(400).json({ error: 'invalid_entry' });
    return;
  }
  const { product_id, grams, local_date, local_time } = req.body;
  const owned = statements.products.ownedByUser.get(req.userId!, product_id);
  if (owned === undefined) {
    res.status(404).json({ error: 'product_not_found' });
    return;
  }
  const result = statements.entries.insert.run(
    req.userId!,
    product_id,
    grams,
    local_date,
    local_time,
    Date.now(),
  ) as { lastInsertRowid: number | bigint };
  const row = statements.entries.selectById.get(req.userId!, Number(result.lastInsertRowid)) as
    | EntryJoinRow
    | undefined;
  if (row === undefined) {
    res.status(500).json({ error: 'insert_failed' });
    return;
  }
  log.info('entry added', {
    userId: req.userId,
    entryId: row.id,
    productId: row.p_id,
    grams: row.grams,
    date: row.local_date,
  });
  res.json(rowToEntry(row));
});

entriesRouter.patch('/:id', (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }
  if (!isUpdateEntryBody(req.body)) {
    res.status(400).json({ error: 'invalid_entry' });
    return;
  }
  const { grams, tagged } = req.body;
  if (grams !== undefined) {
    const r = statements.entries.updateGrams.run(grams, req.userId!, id) as { changes: number };
    if (r.changes === 0) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
  }
  if (tagged !== undefined) {
    const r = statements.entries.updateTagged.run(tagged ? 1 : 0, req.userId!, id) as { changes: number };
    if (r.changes === 0) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
  }
  const row = statements.entries.selectById.get(req.userId!, id) as EntryJoinRow | undefined;
  if (row === undefined) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  log.info('entry updated', {
    userId: req.userId,
    entryId: row.id,
    grams: row.grams,
    tagged: row.tagged,
  });
  res.json(rowToEntry(row));
});

entriesRouter.delete('/:id', (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }
  const result = statements.entries.delete.run(req.userId!, id) as { changes: number };
  if (result.changes === 0) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  log.info('entry deleted', { userId: req.userId, entryId: id });
  res.json({ ok: true });
});
