import type { Goals, Macros, Product } from './types';

export function computeMacros(product: Product, grams: number): Macros {
  const f = grams / 100;
  return {
    kcal: product.per100.kcal * f,
    protein: product.per100.protein * f,
    carbs: product.per100.carbs * f,
    fat: product.per100.fat * f,
  };
}

export const mockGoals: Goals = {
  kcal: 2400,
  protein: 180,
  carbs: 240,
  fat: 80,
};
