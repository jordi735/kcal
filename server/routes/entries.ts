// GET /entries, GET /entries/recent-grams, GET /entries/week,
// entry-group CRUD, POST /entries, PATCH /entries/:id, DELETE /entries/:id.
// Macros computed on read; never stored. Every query scoped by req.userId.

import { Router } from 'express';
import { authMiddleware } from '../auth.js';
import { db } from '../db.js';
import { DATE_RE, TIME_RE, isObject, isPositiveFinite, isPositiveInt } from '../guards.js';
import { log } from '../log.js';
import { statements } from '../statements.js';
import { parsePositiveInt } from '../util.js';
import { normalizeEntryGroupName } from '../../shared/normalize.js';
import type {
  EntryGroup,
  EntryGroupRow,
  EntryJoinRow,
  EntryMembershipRow,
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
    group:
      r.group_id === null || r.group_name === null
        ? null
        : { id: r.group_id, name: r.group_name },
  };
}

function rowToEntryGroup(r: EntryGroupRow): EntryGroup {
  return { id: r.id, name: r.name, local_date: r.local_date };
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

const MAX_GROUP_NAME_LENGTH = 64;

function parseGroupName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const name = normalizeEntryGroupName(v);
  if (name.length === 0 || name.length > MAX_GROUP_NAME_LENGTH) return null;
  return name;
}

function parseNewEntryGroupBody(v: unknown): { name: string; entryIds: number[] } | null {
  if (!isObject(v)) return null;
  const name = parseGroupName(v.name);
  if (name === null || !Array.isArray(v.entry_ids) || v.entry_ids.length < 2) return null;
  if (!v.entry_ids.every(isPositiveInt)) return null;
  const entryIds = v.entry_ids as number[];
  if (new Set(entryIds).size !== entryIds.length) return null;
  return { name, entryIds };
}

function parseRenameEntryGroupBody(v: unknown): string | null {
  if (!isObject(v)) return null;
  return parseGroupName(v.name);
}

function parseTagEntryGroupBody(v: unknown): boolean | null {
  if (!isObject(v) || typeof v.tagged !== 'boolean') return null;
  return v.tagged;
}

class GroupAssignmentConflictError extends Error {}

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

entriesRouter.post('/groups', (req, res) => {
  const parsed = parseNewEntryGroupBody(req.body);
  if (parsed === null) {
    res.status(400).json({ error: 'invalid_group' });
    return;
  }

  const create = db.transaction((userId: number, name: string, entryIds: number[]) => {
    const members: EntryMembershipRow[] = [];
    for (const id of entryIds) {
      const row = statements.entries.selectMembershipById.get(userId, id) as
        | EntryMembershipRow
        | undefined;
      if (row === undefined) return { kind: 'not_found' as const };
      members.push(row);
    }

    const first = members[0]!;
    if (members.some((row) => row.local_date !== first.local_date)) {
      return { kind: 'invalid_group' as const };
    }
    if (members.some((row) => row.group_id !== null)) {
      return { kind: 'already_grouped' as const };
    }

    const inserted = statements.entryGroups.insert.run(
      userId,
      first.local_date,
      name,
      Date.now(),
    ) as { lastInsertRowid: number | bigint };
    const groupId = Number(inserted.lastInsertRowid);
    for (const id of entryIds) {
      const assigned = statements.entries.assignGroup.run(groupId, userId, id) as {
        changes: number;
      };
      if (assigned.changes !== 1) throw new GroupAssignmentConflictError();
    }
    const group = statements.entryGroups.selectById.get(userId, groupId) as
      | EntryGroupRow
      | undefined;
    if (group === undefined) throw new Error('entry group insert failed');
    return { kind: 'created' as const, group };
  });

  let result: ReturnType<typeof create>;
  try {
    result = create(req.userId!, parsed.name, parsed.entryIds);
  } catch (err) {
    if (err instanceof GroupAssignmentConflictError) {
      res.status(409).json({ error: 'already_grouped' });
      return;
    }
    throw err;
  }

  if (result.kind === 'not_found') {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  if (result.kind === 'invalid_group') {
    res.status(400).json({ error: 'invalid_group' });
    return;
  }
  if (result.kind === 'already_grouped') {
    res.status(409).json({ error: 'already_grouped' });
    return;
  }

  log.info('entry group created', {
    userId: req.userId,
    groupId: result.group.id,
    date: result.group.local_date,
    entryCount: parsed.entryIds.length,
  });
  res.status(201).json(rowToEntryGroup(result.group));
});

entriesRouter.patch('/groups/:id/tagged', (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }
  const tagged = parseTagEntryGroupBody(req.body);
  if (tagged === null) {
    res.status(400).json({ error: 'invalid_group' });
    return;
  }

  const update = db.transaction((userId: number, groupId: number) => {
    const group = statements.entryGroups.selectById.get(userId, groupId) as
      | EntryGroupRow
      | undefined;
    if (group === undefined) return null;
    statements.entries.updateTaggedForGroup.run(tagged ? 1 : 0, userId, groupId);
    const rows = statements.entries.selectForDay.all(userId, group.local_date) as EntryJoinRow[];
    return rows.filter((row) => row.group_id === groupId).map(rowToEntry);
  });
  const updated = update(req.userId!, id);
  if (updated === null) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  log.info('entry group tagged', { userId: req.userId, groupId: id, tagged });
  res.json(updated);
});

entriesRouter.patch('/groups/:id', (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }
  const name = parseRenameEntryGroupBody(req.body);
  if (name === null) {
    res.status(400).json({ error: 'invalid_group' });
    return;
  }
  const result = statements.entryGroups.updateName.run(name, req.userId!, id) as {
    changes: number;
  };
  if (result.changes === 0) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const group = statements.entryGroups.selectById.get(req.userId!, id) as
    | EntryGroupRow
    | undefined;
  if (group === undefined) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  log.info('entry group renamed', { userId: req.userId, groupId: id });
  res.json(rowToEntryGroup(group));
});

entriesRouter.delete('/groups/:id', (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }
  const result = statements.entryGroups.delete.run(req.userId!, id) as { changes: number };
  if (result.changes === 0) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  log.info('entry group dissolved', { userId: req.userId, groupId: id });
  res.json({ ok: true });
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
  const remove = db.transaction((userId: number, entryId: number) => {
    const member = statements.entries.selectMembershipById.get(userId, entryId) as
      | EntryMembershipRow
      | undefined;
    if (member === undefined) return null;
    const result = statements.entries.delete.run(userId, entryId) as { changes: number };
    if (result.changes === 0) return null;

    let dissolvedGroupId: number | null = null;
    if (member.group_id !== null) {
      const countRow = statements.entries.countForGroup.get(userId, member.group_id) as {
        count: number;
      };
      if (countRow.count < 2) {
        const dissolved = statements.entryGroups.delete.run(userId, member.group_id) as {
          changes: number;
        };
        if (dissolved.changes === 1) dissolvedGroupId = member.group_id;
      }
    }
    return { dissolvedGroupId };
  });
  const result = remove(req.userId!, id);
  if (result === null) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  log.info('entry deleted', {
    userId: req.userId,
    entryId: id,
    dissolvedGroupId: result.dissolvedGroupId,
  });
  res.json({ ok: true, dissolved_group_id: result.dissolvedGroupId });
});
