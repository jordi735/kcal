// Wire-contract types shared by the Express backend and Preact frontend.
// Both projects re-export these from their local types module so call sites
// keep importing from './types' without reaching into shared/ directly.

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

// Cross-user prefill payload: omits id/is_temp/created_by by construction.
export type ProductTemplate = {
  name: string;
  brand: string | null;
  unit: 'g' | 'ml';
  barcode: string | null;
  per100: Macros;
};

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
  tagged: boolean;
};

export type ExtractedLabel = {
  name: string;
  brand: string | null;
  unit: 'g' | 'ml';
  per100: Macros;
};
