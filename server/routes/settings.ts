// One account-scoped snapshot for editable defaults, dated goals and notices.
import { Router } from 'express';
import { authMiddleware } from '../auth.js';
import { isObject } from '../guards.js';
import { log } from '../log.js';
import { handleWriteError } from '../middleware/write-error.js';
import { dismissMcpNotice, initializeGoalHistory, readSettings, saveGoals } from '../goals.js';
import { MAX_GOAL_KCAL, MAX_GOAL_MACRO_GRAMS } from '../../shared/constraints.js';
import type { GoalsBody } from '../types.js';

export const settingsRouter: Router = Router();
settingsRouter.use(authMiddleware);

function goalInt(value: unknown, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;
}

function isGoalsBody(value: unknown): value is GoalsBody & { time_zone: string } {
  return isObject(value) && typeof value.time_zone === 'string'
    && goalInt(value.kcal, MAX_GOAL_KCAL) && goalInt(value.protein, MAX_GOAL_MACRO_GRAMS)
    && goalInt(value.carbs, MAX_GOAL_MACRO_GRAMS) && goalInt(value.fat, MAX_GOAL_MACRO_GRAMS);
}

settingsRouter.get('/', (req, res) => res.json(readSettings(req.userId!)));

settingsRouter.post('/goal-history/initialize', (req, res) => {
  const result = initializeGoalHistory(req.userId!, isObject(req.body) ? req.body.time_zone : undefined);
  res.json(result);
});

settingsRouter.put('/', (req, res) => {
  if (isObject(req.body) && !('time_zone' in req.body)) {
    res.status(400).json({ error: 'app_refresh_required' });
    return;
  }
  if (!isGoalsBody(req.body)) {
    res.status(400).json({ error: 'invalid_goals' });
    return;
  }
  const result = saveGoals(req.userId!, req.body, req.body.time_zone);
  log.info('goals updated', { userId: req.userId, date: result.effective_date });
  res.json(result);
});

settingsRouter.post('/mcp-notice/dismiss', (req, res) => {
  if (!isObject(req.body) || req.body.version !== 4) {
    res.status(400).json({ error: 'invalid_notice_version' });
    return;
  }
  res.json(dismissMcpNotice(req.userId!, req.body.version));
});

settingsRouter.use(handleWriteError);
