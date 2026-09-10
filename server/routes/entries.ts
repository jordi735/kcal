// GET /entries, GET /entries/recent-grams, GET /entries/week,
// entry-group CRUD, POST /entries, PATCH /entries/:id, DELETE /entries/:id.
// Macros computed on read; never stored. Every query scoped by req.userId.

import { Router } from 'express';
import type { ErrorRequestHandler } from 'express';
import { authMiddleware } from '../auth.js';
import { db } from '../db.js';
import { DATE_RE, TIME_RE, isObject, isPositiveFinite, isPositiveInt } from '../guards.js';
import { log } from '../log.js';
import { statements } from '../statements.js';
import { readDailyTotals, readDayEntries, rowToEntry } from '../reads.js';
import { parsePositiveInt } from '../util.js';
import { createEntry, deleteEntry, updateEntry, WriteError } from '../writes.js';
import { normalizeEntryGroupName } from '../../shared/normalize.js';
import type {
  EntryGroup,
  EntryGroupRow,
  EntryJoinRow,
  EntryMembershipRow,
  NewEntryBody,
} from '../types.js';

export const entriesRouter: Router = Router();

entriesRouter.use(authMiddleware);

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
  res.json(readDayEntries(req.userId!, date));
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
  res.json(readDailyTotals(req.userId!, dates));
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
  res.json(createEntry(req.userId!, req.body));
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
  res.json(updateEntry(req.userId!, id, req.body));
});

entriesRouter.delete('/:id', (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }
  const result = deleteEntry(req.userId!, id);
  res.json({ ok: true, dissolved_group_id: result.dissolved_group_id });
});

const handleWriteError: ErrorRequestHandler = (err: unknown, _req, res, next) => {
  if (err instanceof WriteError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  next(err);
};

entriesRouter.use(handleWriteError);
