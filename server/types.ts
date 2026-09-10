// Shared backend types. Every `type` alias in the server lives here.
// The one exception is the `Express.Request` augmentation in auth.ts, which
// must stay an `interface` because TS module-augmentation requires it.

// --- env / logging ---

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// --- shared shapes ---

export type {
  Macros,
  Product,
  ProductTemplate,
  BarcodeLookupResponse,
  EntryGroupRef,
  EntryGroup,
  EntryWithMacros,
  ExtractedLabel,
  WeightInput,
  WeightEntry,
  OAuthConsent,
  OAuthDecision,
  McpDayResult,
  McpMealsResult,
  McpWeekResult,
  McpWeighinsResult,
  WeightSummaryPoint,
  McpSummaryResult,
  McpProductSearchResult,
  McpEntryWriteResult,
  McpEntryDeleteResult,
  McpProductWriteResult,
  McpProductDeleteResult,
} from '../shared/types.js';

import type { Macros } from '../shared/types.js';

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

export type NewProductBody = {
  name: string;
  brand: string | null;
  unit: 'g' | 'ml';
  barcode: string | null;
  per100: Macros;
  is_temp: boolean;
};

export type UpdateProductBody = Omit<NewProductBody, 'is_temp'>;

export type ProductPatch = Partial<Omit<UpdateProductBody, 'per100'>> & {
  per100?: Partial<Macros>;
};

export type ScanTally = { date: string; count: number };

// --- entries ---

export type EntryJoinRow = {
  id: number;
  grams: number;
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

export type NewEntryBody = {
  product_id: number;
  grams: number;
  local_date: string;
  local_time: string;
};

export type EntryUpdate = { grams?: number; tagged?: boolean };

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
};

// --- db plumbing ---

export type MigrationRow = { filename: string };

// --- Codex runner / vision extraction ---

export type CodexInput = string | ReadonlyArray<
  | { type: 'text'; text: string }
  | { type: 'local_image'; path: string }
>;

export type CodexReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export type CodexUsage = {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
};

export type CodexRunOptions = {
  model: string;
  modelReasoningEffort: CodexReasoningEffort;
  workingDirectory: string;
  outputSchema: object;
  timeoutMs: number;
};

export type CodexJsonTurn = {
  finalResponse: string;
  threadId: string;
  usage: CodexUsage | null;
};

export type NormalizedCodexInput = {
  prompt: string;
  images: string[];
};

export type CodexSchemaFile = {
  path: string;
  cleanup: () => Promise<void>;
};

export type CodexThreadEvent =
  | { type: 'thread.started'; thread_id: string }
  | { type: 'turn.completed'; usage: CodexUsage }
  | { type: 'turn.failed'; error: { message: string } }
  | { type: 'item.completed'; item: { type?: string; text?: string; message?: string } }
  | { type: 'error'; message: string };

export type SupportedImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

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
