// Private, date-only weigh-in CRUD. Every statement is scoped by req.userId.

import { Router } from 'express';
import { authMiddleware } from '../auth.js';
import { DATE_RE, isObject } from '../guards.js';
import { log } from '../log.js';
import { statements } from '../statements.js';
import { readWeights, rowToWeight } from '../reads.js';
import { parsePositiveInt } from '../util.js';
import type { WeightInput, WeightRow } from '../types.js';

export const weightsRouter: Router = Router();

weightsRouter.use(authMiddleware);

const MIN_WEIGHT_KG = 0.1;
const MAX_WEIGHT_KG = 1000;
const MAX_NOTE_LENGTH = 500;

function hasOneDecimalAtMost(value: number): boolean {
  const tenths = value * 10;
  return Math.abs(tenths - Math.round(tenths)) < 1e-9;
}

function parseWeightInput(value: unknown): WeightInput | null {
  if (!isObject(value)) return null;
  const { local_date, weight_kg, note } = value;
  if (typeof local_date !== 'string' || !DATE_RE.test(local_date)) return null;
  if (
    typeof weight_kg !== 'number' ||
    !Number.isFinite(weight_kg) ||
    weight_kg < MIN_WEIGHT_KG ||
    weight_kg > MAX_WEIGHT_KG ||
    !hasOneDecimalAtMost(weight_kg)
  ) {
    return null;
  }
  if (note !== null && typeof note !== 'string') return null;
  const normalizedNote = typeof note === 'string' ? note.trim() : null;
  if (normalizedNote !== null && normalizedNote.length > MAX_NOTE_LENGTH) return null;
  return {
    local_date,
    weight_kg,
    note: normalizedNote === '' ? null : normalizedNote,
  };
}

function isDateConflict(error: unknown): boolean {
  if (!isObject(error)) return false;
  return (
    error.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    (error.code === 'SQLITE_CONSTRAINT' &&
      typeof error.message === 'string' &&
      error.message.includes('weights.user_id, weights.local_date'))
  );
}

weightsRouter.get('/', (req, res) => {
  res.json(readWeights(req.userId!));
});

weightsRouter.post('/', (req, res) => {
  const input = parseWeightInput(req.body);
  if (input === null) {
    res.status(400).json({ error: 'invalid_weight' });
    return;
  }

  let inserted: { lastInsertRowid: number | bigint };
  try {
    inserted = statements.weights.insert.run(
      req.userId!,
      input.local_date,
      input.weight_kg,
      input.note,
      Date.now(),
    ) as { lastInsertRowid: number | bigint };
  } catch (error) {
    if (isDateConflict(error)) {
      res.status(409).json({ error: 'weight_exists' });
      return;
    }
    throw error;
  }

  const row = statements.weights.selectById.get(
    req.userId!,
    Number(inserted.lastInsertRowid),
  ) as WeightRow | undefined;
  if (row === undefined) {
    res.status(500).json({ error: 'insert_failed' });
    return;
  }
  log.info('weight added', { userId: req.userId, weightId: row.id });
  res.status(201).json(rowToWeight(row));
});

weightsRouter.put('/:id', (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }
  const input = parseWeightInput(req.body);
  if (input === null) {
    res.status(400).json({ error: 'invalid_weight' });
    return;
  }

  let updated: { changes: number };
  try {
    updated = statements.weights.update.run(
      input.local_date,
      input.weight_kg,
      input.note,
      req.userId!,
      id,
    ) as { changes: number };
  } catch (error) {
    if (isDateConflict(error)) {
      res.status(409).json({ error: 'weight_exists' });
      return;
    }
    throw error;
  }
  if (updated.changes === 0) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  const row = statements.weights.selectById.get(req.userId!, id) as WeightRow | undefined;
  if (row === undefined) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  log.info('weight updated', { userId: req.userId, weightId: id });
  res.json(rowToWeight(row));
});

weightsRouter.delete('/:id', (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }
  const deleted = statements.weights.delete.run(req.userId!, id) as { changes: number };
  if (deleted.changes === 0) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  log.info('weight deleted', { userId: req.userId, weightId: id });
  res.json({ ok: true });
});
