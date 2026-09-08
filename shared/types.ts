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

export type EntryGroupRef = {
  id: number;
  name: string;
};

export type EntryGroup = EntryGroupRef & {
  local_date: string;
};

export type EntryWithMacros = {
  id: number;
  product: Product;
  grams: number;
  local_date: string;
  local_time: string;
  macros: Macros;
  tagged: boolean;
  group: EntryGroupRef | null;
};

export type ExtractedLabel = {
  name: string;
  brand: string | null;
  unit: 'g' | 'ml';
  per100: Macros;
};

export type WeightInput = {
  local_date: string;
  weight_kg: number;
  note: string | null;
};

export type WeightEntry = WeightInput & {
  id: number;
};

export type OAuthConsent = {
  client_name: string;
  redirect_host: string;
  email: string;
};

export type OAuthDecision = { redirect_url: string };

// Read-only MCP results. Goals always describe the current settings;
// recorded totals use current product nutrition, as the app does.
export type McpDayResult = {
  user_id: number;
  date: string;
  entries: EntryWithMacros[];
  totals: Macros;
  current_daily_goals: Macros;
};

export type McpMealsResult = {
  user_id: number;
  start_date: string;
  end_date: string;
  days: Record<string, {
    entries: EntryWithMacros[];
    totals: Macros;
  }>;
};

export type McpWeekResult = {
  user_id: number;
  start_date: string;
  end_date: string;
  days: Record<string, Macros>;
  totals: Macros;
  current_daily_goals: Macros;
};

export type McpWeighinsResult = {
  user_id: number;
  weighins: WeightEntry[];
  next_offset: number | null;
};
