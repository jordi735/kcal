export type Macros = {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
};

export type Product = {
  id: number;
  name: string;
  brand: string | null;
  unit: 'g' | 'ml';
  barcode: string | null;
  per100: Macros;
  is_temp: boolean;
  // Only set on /products/search rows — undefined elsewhere.
  is_mine?: boolean;
};

// Cross-user prefill payload from GET /products/barcode/:code (kind: 'template').
export type ProductTemplate = Pick<
  Product,
  'name' | 'brand' | 'unit' | 'barcode' | 'per100'
>;

export type BarcodeLookupResponse =
  | { kind: 'own'; product: Product }
  | { kind: 'template'; template: ProductTemplate };

export type EntryWithMacros = {
  id: number;
  product: Product;
  grams: number;
  local_date: string;
  local_time: string;
  macros: Macros;
};

export type Goals = {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
};

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
