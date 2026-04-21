// GET/PUT /settings — the authed user's daily macro goals.
// Every query is scoped by req.userId; caps prevent absurd values.

import { Router } from 'express';
import { authMiddleware } from '../auth.js';
import { isObject } from '../guards.js';
import { log } from '../log.js';
import { statements } from '../statements.js';
import type { GoalsBody } from '../types.js';

export const settingsRouter: Router = Router();

settingsRouter.use(authMiddleware);

const MAX_KCAL = 20000;
const MAX_MACRO_GRAMS = 2000;

function isGoalInt(v: unknown, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;
}

function isGoalsBody(v: unknown): v is GoalsBody {
  if (!isObject(v)) return false;
  return (
    isGoalInt(v.kcal, MAX_KCAL) &&
    isGoalInt(v.protein, MAX_MACRO_GRAMS) &&
    isGoalInt(v.carbs, MAX_MACRO_GRAMS) &&
    isGoalInt(v.fat, MAX_MACRO_GRAMS)
  );
}

settingsRouter.put('/', (req, res) => {
  if (!isGoalsBody(req.body)) {
    res.status(400).json({ error: 'invalid_goals' });
    return;
  }
  const { kcal, protein, carbs, fat } = req.body;
  statements.users.updateGoals.run(kcal, protein, carbs, fat, req.userId!);
  log.info('goals updated', { userId: req.userId });
  res.json({ kcal, protein, carbs, fat });
});
