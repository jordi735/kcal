import type { Macros } from './types.js';

// Keep scaling and accumulation unrounded; display callers choose formatting.
// Match SQLite's multiply-then-divide order, including halfway rounding cases.
export function scaleMacros(per100: Macros, amount: number): Macros {
  return {
    kcal: amount * per100.kcal / 100,
    protein: amount * per100.protein / 100,
    carbs: amount * per100.carbs / 100,
    fat: amount * per100.fat / 100,
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
