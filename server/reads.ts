// Read helpers shared by HTTP routes and MCP tools. Callers resolve the user
// from verified credentials; every statement keeps its owner binding.

import { statements } from './statements.js';
import type {
  EntryJoinRow, EntryWithMacros, GoalsRow, Macros, McpSummaryResult, Product, ProductRow,
  WeightEntry, WeightRow, WeightSummaryPoint, WeekSumRow,
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

export function rowToProduct(r: ProductRow): Product {
  return {
    id: r.id,
    name: r.name,
    brand: r.brand,
    unit: r.unit === 'ml' ? 'ml' : 'g',
    barcode: r.barcode,
    per100: {
      kcal: r.kcal_per100,
      protein: r.protein_per100,
      carbs: r.carbs_per100,
      fat: r.fat_per100,
    },
    is_temp: r.is_temp === 1,
  };
}

export function searchOwnProducts(userId: number, query: string): Product[] {
  const q = query.trim();
  if (q === '') return [];
  const pattern = `%${q}%`;
  const rows = statements.products.searchOwn.all(userId, pattern, pattern) as ProductRow[];
  return rows.map(rowToProduct);
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

export function readSummary(
  userId: number, dates: readonly string[],
): Omit<McpSummaryResult, 'user_id' | 'start_date' | 'end_date' | 'current_daily_goals'> {
  const start = dates[0];
  const end = dates.at(-1);
  const validDates = new Set(dates);
  // Existing REST writes accept date-shaped strings. Project onto the requested
  // calendar dates, as readDailyTotals does, so impossible stored dates don't count.
  const rows = start === undefined || end === undefined ? []
    : statements.entries.weekSum.all(userId, start, end) as WeekSumRow[];
  const logged = rows.filter((row) => validDates.has(row.date));
  const totals = sumMacros(logged);
  const daysLogged = logged.length;
  const points = start === undefined || end === undefined ? []
    : statements.weights.summaryRange.all(userId, start, end) as WeightSummaryPoint[];
  const weighins = points.filter((point) => validDates.has(point.local_date));
  const first = weighins[0] ?? null;
  const last = weighins.at(-1) ?? null;
  return {
    days_total: dates.length,
    days_logged: daysLogged,
    days_without_entries: dates.length - daysLogged,
    totals,
    average_on_logged_days: daysLogged === 0 ? null : {
      kcal: totals.kcal / daysLogged,
      protein: totals.protein / daysLogged,
      carbs: totals.carbs / daysLogged,
      fat: totals.fat / daysLogged,
    },
    weight: {
      weighin_count: weighins.length,
      first,
      last,
      change_kg: weighins.length < 2 || first === null || last === null
        ? null : Number((last.weight_kg - first.weight_kg).toFixed(1)),
    },
  };
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
