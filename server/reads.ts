// Read helpers shared by HTTP routes and the admin MCP tools. Callers choose
// the user only after authenticating; every statement keeps its owner binding.

import { statements } from './statements.js';
import type {
  EntryJoinRow, EntryWithMacros, GoalsRow, Macros, WeightEntry, WeightRow, WeekSumRow,
} from './types.js';

export function readGoals(userId: number): Macros | null {
  const row = statements.users.selectGoalsById.get(userId) as GoalsRow | undefined;
  return row === undefined ? null : {
    kcal: row.goal_kcal,
    protein: row.goal_protein,
    carbs: row.goal_carbs,
    fat: row.goal_fat,
  };
}

export function rowToEntry(r: EntryJoinRow): EntryWithMacros {
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

export function readDayEntries(userId: number, date: string): EntryWithMacros[] {
  const rows = statements.entries.selectForDay.all(userId, date) as EntryJoinRow[];
  return rows.map(rowToEntry);
}

export function sumMacros(values: Iterable<Macros>): Macros {
  const total: Macros = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const value of values) {
    total.kcal += value.kcal;
    total.protein += value.protein;
    total.carbs += value.carbs;
    total.fat += value.fat;
  }
  return total;
}

export function readDailyTotals(userId: number, dates: readonly string[]): Record<string, Macros> {
  const start = dates[0];
  const end = dates.at(-1);
  if (start === undefined || end === undefined) return {};
  const rows = statements.entries.weekSum.all(userId, start, end) as WeekSumRow[];
  const byDate = new Map(rows.map((row) => [row.date, row]));
  return Object.fromEntries(dates.map((date) => {
    const row = byDate.get(date);
    return [date, row === undefined
      ? { kcal: 0, protein: 0, carbs: 0, fat: 0 }
      : { kcal: row.kcal, protein: row.protein, carbs: row.carbs, fat: row.fat }];
  }));
}

export function rowToWeight(row: WeightRow): WeightEntry {
  return {
    id: row.id,
    local_date: row.local_date,
    weight_kg: row.weight_kg,
    note: row.note,
  };
}

export function readWeights(userId: number): WeightEntry[] {
  const rows = statements.weights.all.all(userId) as WeightRow[];
  return rows.map(rowToWeight);
}

export function readWeightPage(
  userId: number, start: string, end: string, limit: number, offset: number,
): WeightEntry[] {
  const rows = statements.weights.inRange.all(userId, start, end, limit, offset) as WeightRow[];
  return rows.map(rowToWeight);
}
