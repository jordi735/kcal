// GET /entries, GET /entries/recent-grams, GET /entries/week,
// entry-group CRUD, POST /entries, PATCH /entries/:id, DELETE /entries/:id.
// Macros computed on read; never stored. Every query scoped by req.userId.

import { Router } from 'express';
import { datesFromStart } from '../../shared/dates.js';
import { log } from '../log.js';
import { authMiddleware } from '../auth.js';
import { DATE_RE, isObject, isPositiveInt } from '../guards.js';
import { statements } from '../statements.js';
import { readDailyTotals, readDayEntries } from '../reads.js';
import { parsePositiveInt } from '../util.js';
import { handleWriteError } from '../middleware/write-error.js';
import {
  createEntry, deleteEntry, updateEntry,
  createEntryGroup, updateEntryGroup, setEntryGroupTagged, ungroupEntries,
} from '../writes.js';
import { isEntryAmount, isLocalDate, isLocalTime, parseEntryGroupName } from '../../shared/constraints.js';
import type { NewEntryBody } from '../types.js';

export const entriesRouter: Router = Router();

entriesRouter.use(authMiddleware);

function isNewEntryBody(v: unknown): v is NewEntryBody {
  if (!isObject(v)) return false;
  return (
    isPositiveInt(v.product_id) &&
    isEntryAmount(v.grams) &&
    typeof v.local_date === 'string' && isLocalDate(v.local_date) &&
    typeof v.local_time === 'string' && isLocalTime(v.local_time)
  );
}

function isUpdateEntryBody(v: unknown): v is { grams?: number; tagged?: boolean } {
  if (!isObject(v)) return false;
  if ('grams' in v && !isEntryAmount(v.grams)) return false;
  if ('tagged' in v && typeof v.tagged !== 'boolean') return false;
  if (!('grams' in v) && !('tagged' in v)) return false;
  return true;
}

function parseNewEntryGroupBody(v: unknown): { name: string; entryIds: number[] } | null {
  if (!isObject(v)) return null;
  const name = parseEntryGroupName(v.name);
  if (name === null || !Array.isArray(v.entry_ids) || v.entry_ids.length < 2) return null;
  if (!v.entry_ids.every(isPositiveInt)) return null;
  const entryIds = v.entry_ids as number[];
  if (new Set(entryIds).size !== entryIds.length) return null;
  return { name, entryIds };
}

function parseRenameEntryGroupBody(v: unknown): string | null {
  if (!isObject(v)) return null;
  return parseEntryGroupName(v.name);
}

function parseTagEntryGroupBody(v: unknown): boolean | null {
  if (!isObject(v) || typeof v.tagged !== 'boolean') return null;
  return v.tagged;
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
  if (!isLocalDate(start)) {
    res.status(400).json({ error: 'invalid_date' });
    return;
  }
  let dates: string[];
  try { dates = datesFromStart(start, 7); }
  catch { res.status(400).json({ error: 'invalid_date' }); return; }
  res.json(readDailyTotals(req.userId!, dates));
});

entriesRouter.post('/groups', (req, res) => {
  const parsed = parseNewEntryGroupBody(req.body);
  if (parsed === null) {
    res.status(400).json({ error: 'invalid_group' });
    return;
  }

  const result = createEntryGroup(req.userId!, parsed.name, parsed.entryIds);
  log.info('entry group created', { userId: req.userId, groupId: result.group.id });
  res.status(201).json(result.group);
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

  const result = setEntryGroupTagged(req.userId!, id, tagged);
  log.info('entry group tagged', { userId: req.userId, groupId: id });
  res.json(result.entries);
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
  const result = updateEntryGroup(req.userId!, id, name);
  log.info('entry group renamed', { userId: req.userId, groupId: id });
  res.json(result.group);
});

entriesRouter.delete('/groups/:id', (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }
  ungroupEntries(req.userId!, id);
  log.info('entry group dissolved', { userId: req.userId, groupId: id });
  res.json({ ok: true });
});

entriesRouter.post('/', (req, res) => {
  if (!isNewEntryBody(req.body)) {
    res.status(400).json({ error: 'invalid_entry' });
    return;
  }
  const result = createEntry(req.userId!, req.body);
  log.info('entry added', { userId: req.userId, entryId: result.id });
  res.json(result);
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
  const result = updateEntry(req.userId!, id, req.body);
  log.info('entry updated', { userId: req.userId, entryId: id });
  res.json(result);
});

entriesRouter.delete('/:id', (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }
  const result = deleteEntry(req.userId!, id);
  log.info('entry deleted', { userId: req.userId, entryId: id });
  res.json({ ok: true, dissolved_group_id: result.dissolved_group_id });
});

entriesRouter.use(handleWriteError);
