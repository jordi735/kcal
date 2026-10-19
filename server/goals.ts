import { db } from './db.js';
import { statements } from './statements.js';
import { WriteError } from './errors.js';
import { sumMacros } from '../shared/macros.js';
import { resolveGoals, sameGoals } from '../shared/goals.js';
import { isLocalDate } from '../shared/constraints.js';
import type { GoalComparison, GoalHistoryItem, GoalHistoryRow, GoalsRow, Macros, SettingsSaveResult, SettingsSnapshot } from './types.js';

function rowGoals(row: GoalHistoryRow): Macros {
  return { kcal: row.kcal, protein: row.protein, carbs: row.carbs, fat: row.fat };
}

export function readGoalHistory(userId: number): GoalHistoryItem[] {
  return (statements.goalHistory.all.all(userId) as GoalHistoryRow[])
    .map((row) => ({ effective_date: row.effective_date, goals: rowGoals(row) }));
}

// Undated values are editable defaults / auth compatibility, never historical goals.
export function readCurrentGoals(userId: number): Macros | null {
  const latest = statements.goalHistory.latest.get(userId) as GoalHistoryRow | undefined;
  if (latest !== undefined) return rowGoals(latest);
  const row = statements.users.selectGoalsById.get(userId) as GoalsRow | undefined;
  return row === undefined ? null : {
    kcal: row.goal_kcal, protein: row.goal_protein, carbs: row.goal_carbs, fat: row.goal_fat,
  };
}

export function readSettings(userId: number): SettingsSnapshot {
  const goals = readCurrentGoals(userId);
  const user = statements.users.notice.get(userId) as { mcp_notice_version: number | null } | undefined;
  if (goals === null || user === undefined) throw new WriteError(404, 'not_found');
  return { ...goals, goal_history: readGoalHistory(userId), mcp_notice_version: user.mcp_notice_version };
}

export function localDateInTimeZone(timeZone: unknown, now = Date.now()): string {
  if (typeof timeZone !== 'string' || timeZone.length === 0 || timeZone.length > 100
    || /^[+-]/.test(timeZone)) throw new WriteError(400, 'invalid_time_zone');
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now);
    const part = (kind: string) => parts.find((value) => value.type === kind)!.value;
    const date = `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
    if (!isLocalDate(date)) throw new Error('invalid_date');
    return date;
  } catch {
    throw new WriteError(400, 'invalid_time_zone');
  }
}

function putGoals(userId: number, date: string, goals: Macros, now: number): void {
  statements.goalHistory.upsert.run(userId, date, goals.kcal, goals.protein, goals.carbs, goals.fat, now);
}

export function initializeGoalHistory(userId: number, timeZone: unknown): SettingsSnapshot {
  const now = Date.now();
  const date = localDateInTimeZone(timeZone, now);
  return db.transaction(() => {
    const current = readSettings(userId);
    if (current.goal_history.length === 0) putGoals(userId, date, current, now);
    return readSettings(userId);
  }).immediate();
}

export function saveGoals(userId: number, goals: Macros, timeZone: unknown): SettingsSaveResult {
  const now = Date.now();
  const date = localDateInTimeZone(timeZone, now);
  return db.transaction(() => {
    const current = readSettings(userId);
    const latest = current.goal_history.at(-1);
    if (latest !== undefined && date < latest.effective_date) throw new WriteError(409, 'goal_date_before_latest');
    if (latest === undefined || !sameGoals(latest.goals, goals)) putGoals(userId, date, goals, now);
    return { ...readSettings(userId), effective_date: date };
  }).immediate();
}

export function dismissMcpNotice(userId: number, version: number): { mcp_notice_version: number | null } {
  return db.transaction(() => {
    statements.users.dismissNotice.run(userId, version);
    const user = statements.users.notice.get(userId) as { mcp_notice_version: number | null } | undefined;
    if (user === undefined) throw new WriteError(404, 'not_found');
    return user;
  })();
}

// Pure comparison over the caller's valid logged dates. Missing logs must stay
// absent; a recorded zero-calorie day is still a comparison candidate.
export function compareLoggedGoals(
  history: readonly GoalHistoryItem[], loggedTotals: Readonly<Record<string, Macros>>,
): GoalComparison {
  const goals: Macros[] = [];
  const compared: Macros[] = [];
  for (const [date, totals] of Object.entries(loggedTotals)) {
    const dailyGoals = resolveGoals(history, date);
    if (dailyGoals !== null) {
      compared.push(totals);
      goals.push(dailyGoals);
    }
  }
  return {
    days_compared: compared.length,
    logged_totals: compared.length === 0 ? null : sumMacros(compared),
    goal_totals: compared.length === 0 ? null : sumMacros(goals),
  };
}
