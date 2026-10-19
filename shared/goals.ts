import type { GoalHistoryItem, GoalPeriod, Macros } from './types.js';

export function sameGoals(a: Macros | null, b: Macros | null): boolean {
  return a === null || b === null ? a === b
    : a.kcal === b.kcal && a.protein === b.protein && a.carbs === b.carbs && a.fat === b.fat;
}

// History is ascending and sparse. Do not infer targets before its first row.
export function resolveGoals(history: readonly GoalHistoryItem[], date: string): Macros | null {
  let low = 0;
  let high = history.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (history[middle]!.effective_date <= date) low = middle + 1;
    else high = middle;
  }
  return low === 0 ? null : history[low - 1]!.goals;
}

// Dates are an ascending contiguous inclusive range, validated by the caller.
export function goalPeriods(history: readonly GoalHistoryItem[], dates: readonly string[]): GoalPeriod[] {
  const periods: GoalPeriod[] = [];
  for (const date of dates) {
    const goals = resolveGoals(history, date);
    const last = periods.at(-1);
    if (last !== undefined && sameGoals(last.daily_goals, goals)) last.end_date = date;
    else periods.push({ start_date: date, end_date: date, daily_goals: goals });
  }
  return periods;
}
