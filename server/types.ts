// Shared backend types. Every `type` alias in the server lives here.
// The one exception is the `Express.Request` augmentation in auth.ts, which
// must stay an `interface` because TS module-augmentation requires it.

// --- env / logging ---

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// --- shared shapes ---

export type {
  User,
  VerifyCodeResponse,
  NewEntryBody,
  NewProductBody,
  UpdateProductBody,
  Macros,
  Product,
  ProductTemplate,
  BarcodeLookupResponse,
  EntryGroupRef,
  EntryGroup,
  EntryWithMacros,
  EntryUpdate,
  McpEntry,
  WeightInput,
  WeightEntry,
  OAuthConsent,
  OAuthDecision,
  McpDayResult,
  McpMealsResult,
  McpWeekResult,
  McpWeighinsResult,
  WeightSummaryPoint,
  SummaryResult,
  McpSummaryResult,
  McpProductSearchResult,
  McpEntryWriteResult,
  McpEntryDeleteResult,
  McpProductWriteResult,
  McpProductDeleteResult,
  EntryGroupResult,
  UngroupResult,
  EntryGroupDeleteResult,
  McpEntryGroupResult,
  McpUngroupResult,
  McpEntryGroupDeleteResult,
  GoalHistoryItem,
  GoalPeriod,
  GoalComparison,
  SettingsSnapshot,
  SettingsSaveResult,
  McpCreationReceipt,
  McpEntriesCreateResult,
  McpProductCreateResult,
  McpEntryGroupCreateResult,
} from '../shared/types.js';

import type { Macros, Product, UpdateProductBody } from '../shared/types.js';

export type OAuthRequestRow = {
  id_hash: string;
  browser_hash: string;
  client_id: string;
  redirect_uri: string;
  state: string | null;
  challenge: string;
  resource: string;
  scopes: string;
  expires_at: number;
  user_id: number | null;
  code_hash: string | null;
};

export type OAuthGrantRow = {
  id: string;
  user_id: number;
  client_id: string;
  resource: string;
  scopes: string;
  expires_at: number;
  revoked: number;
};

export type OAuthTokenRow = OAuthGrantRow & {
  kind: 'access' | 'refresh';
  used: number;
  token_expires_at: number;
  token_scopes: string;
};

// --- auth / sessions ---

export type LoginCodeEntry = { code: string; expiresAt: number; attempts: number };

export type SessionInfo = { token: string; expiresAt: number };

export type SessionRow = {
  user_id: number;
  expires_at: number;
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

export type GoalsBody = Macros;

export type GoalsRow = {
  goal_kcal: number;
  goal_protein: number;
  goal_carbs: number;
  goal_fat: number;
};

export type GoalHistoryRow = {
  effective_date: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  updated_at: number;
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

// Adopt-source rows include the owner so the product service can check ownership.
export type ProductRowWithOwner = ProductRow & { created_by: number };

export type ProductAdoptionResult = {
  product: Product;
  created: boolean;
};

// Database bindings preserve legacy stored units rather than narrowing them to
// the validated request union. Adoption copies source values without normalizing.
export type ProductInsertBindings = [
  name: string, brand: string | null, unit: string, barcode: string | null,
  kcal: number, protein: number, carbs: number, fat: number,
  isTemp: number, userId: number, createdAt: number,
];

export type ProductUpdateBindings = [
  name: string, brand: string | null, unit: string, barcode: string | null,
  kcal: number, protein: number, carbs: number, fat: number,
  userId: number, productId: number,
];

export type ProductPatch = Partial<Omit<UpdateProductBody, 'per100'>> & {
  per100?: Partial<Macros>;
};

// --- entries ---

export type EntryJoinRow = {
  id: number;
  amount: number;
  local_date: string;
  local_time: string;
  tagged: number;
  group_id: number | null;
  group_name: string | null;
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

export type WeekSumRow = {
  date: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
};

export type EntryMembershipRow = {
  id: number;
  local_date: string;
  group_id: number | null;
};

export type EntryGroupRow = {
  id: number;
  user_id: number;
  local_date: string;
  name: string;
  created_at: number;
};

// --- weights ---

export type WeightRow = {
  id: number;
  local_date: string;
  weight_kg: number;
  note: string | null;
  peed: number;
  pooped: number;
};

// --- db plumbing ---

export type MigrationRow = { filename: string };

export type McpCreationReceiptRow = {
  tool_name: string;
  request_hash: string;
  result_json: string;
  applied_at: number;
  schema_version: number;
};
