// Shared backend types. Every `type` alias in the server lives here.
// The one exception is the `Express.Request` augmentation in auth.ts, which
// must stay an `interface` because TS module-augmentation requires it.

// --- env / logging ---

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// --- shared shapes ---

export type Macros = {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
};

// --- auth / sessions ---

export type MagicEntry = { email: string; expiresAt: number };

export type SessionInfo = { token: string; expiresAt: number };

export type SessionUserRow = {
  user_id: number;
  expires_at: number;
  id: number;
  email: string;
  goal_kcal: number;
  goal_protein: number;
  goal_carbs: number;
  goal_fat: number;
};

// --- users / settings ---

export type UserRow = {
  id: number;
  email: string;
  goal_kcal: number;
  goal_protein: number;
  goal_carbs: number;
  goal_fat: number;
};

// Structurally identical to UserRow — the DB row IS the authed-user shape.
export type AuthedUser = UserRow;

export type GoalsBody = Macros;

export type GoalsRow = {
  goal_kcal: number;
  goal_protein: number;
  goal_carbs: number;
  goal_fat: number;
};

// --- products ---

export type ProductRow = {
  id: number;
  name: string;
  brand: string | null;
  unit: string;
  barcode: string | null;
  kcal_per100: number;
  protein_per100: number;
  carbs_per100: number;
  fat_per100: number;
  is_temp: number;
};

// Search result rows include the computed is_mine flag (0 or 1 from SQLite).
export type ProductSearchRow = ProductRow & { is_mine: number };

// Adopt-source rows include the owner so the route can branch on ownership.
export type ProductRowWithOwner = ProductRow & { created_by: number };

export type Product = {
  id: number;
  name: string;
  brand: string | null;
  unit: 'g' | 'ml';
  barcode: string | null;
  per100: Macros;
  is_temp: boolean;
  // Only set on /products/search results — undefined elsewhere.
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

export type NewProductBody = {
  name: string;
  brand: string | null;
  unit: 'g' | 'ml';
  barcode: string | null;
  per100: Macros;
  is_temp: boolean;
};

export type UpdateProductBody = Omit<NewProductBody, 'is_temp'>;

export type ScanTally = { date: string; count: number };

// --- entries ---

export type EntryJoinRow = {
  id: number;
  grams: number;
  local_date: string;
  local_time: string;
  p_id: number;
  p_name: string;
  p_brand: string | null;
  p_unit: string;
  p_barcode: string | null;
  p_kcal_per100: number;
  p_protein_per100: number;
  p_carbs_per100: number;
  p_fat_per100: number;
  p_is_temp: number;
};

export type EntryWithMacros = {
  id: number;
  product: Product;
  grams: number;
  local_date: string;
  local_time: string;
  macros: Macros;
};

export type WeekSumRow = {
  date: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  entry_count: number;
};

export type NewEntryBody = {
  product_id: number;
  grams: number;
  local_date: string;
  local_time: string;
};

// --- db plumbing ---

export type MigrationRow = { filename: string };

// --- claude vision extraction ---

export type ExtractedLabel = {
  name: string;
  brand: string | null;
  unit: 'g' | 'ml';
  per100: Macros;
};

export type Base64ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

export type RawPer100 = {
  kcal?: unknown;
  protein?: unknown;
  carbs?: unknown;
  fat?: unknown;
};

export type RawExtraction = {
  name?: unknown;
  brand?: unknown;
  unit?: unknown;
  per100?: unknown;
};
