export type {
  Macros,
  Product,
  ProductTemplate,
  BarcodeLookupResponse,
  EntryWithMacros,
  ExtractedLabel,
} from '../shared/types.js';

import type { EntryWithMacros, Macros } from '../shared/types.js';

export type Goals = Macros;

export type User = {
  id: number;
  email: string;
  goal_kcal: number;
  goal_protein: number;
  goal_carbs: number;
  goal_fat: number;
};

export function sumMacros(list: ReadonlyArray<EntryWithMacros>): Macros {
  const total: Macros = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const e of list) {
    total.kcal += e.macros.kcal;
    total.protein += e.macros.protein;
    total.carbs += e.macros.carbs;
    total.fat += e.macros.fat;
  }
  return total;
}
