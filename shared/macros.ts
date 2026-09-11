import type { Macros } from './types.js';

// Keep scaling and accumulation unrounded; display callers choose formatting.
// SQLite aggregation has its own existing arithmetic and is intentionally not
// rewritten here.
export function scaleMacros(per100: Macros, grams: number): Macros {
  const factor = grams / 100;
  return {
    kcal: per100.kcal * factor,
    protein: per100.protein * factor,
    carbs: per100.carbs * factor,
    fat: per100.fat * factor,
  };
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
