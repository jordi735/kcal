// Wire-contract types shared by the Express backend and Preact frontend.
// Both projects re-export these from their local types module so call sites
// keep importing from './types' without reaching into shared/ directly.

export type Macros = {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
};

export type GoalHistoryItem = { effective_date: string; goals: Macros };
export type GoalPeriod = { start_date: string; end_date: string; daily_goals: Macros | null };
export type GoalComparison = {
  days_compared: number;
  logged_totals: Macros | null;
  goal_totals: Macros | null;
};
export type SettingsSnapshot = Macros & {
  goal_history: GoalHistoryItem[];
  mcp_notice_version: number | null;
};
export type SettingsSaveResult = SettingsSnapshot & { effective_date: string };

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

export type WeightInput = {
  local_date: string;
  weight_kg: number;
  note: string | null;
  peed?: boolean;
  pooped?: boolean;
};

export type WeightEntry = WeightInput & {
  id: number;
  peed: boolean;
  pooped: boolean;
};

export type OAuthConsent = {
  client_name: string;
  redirect_host: string;
  email: string;
  scopes: string[];
};

export type OAuthDecision = { redirect_url: string };

// Goals resolve for each recorded date; null means history is unknown.
// Recorded totals use current product nutrition, as the app does.
// Food checkmarks are an app-only aid, not a record of actual consumption.
export type McpEntry = Omit<EntryWithMacros, 'tagged'>;

export type McpDayResult = {
  user_id: number;
  date: string;
  entries: McpEntry[];
  totals: Macros;
  daily_goals: Macros | null;
};

export type McpMealsResult = {
  user_id: number;
  start_date: string;
  end_date: string;
  days: Record<string, {
    entries: McpEntry[];
    totals: Macros;
    daily_goals: Macros | null;
  }>;
};

export type McpWeekResult = {
  user_id: number;
  start_date: string;
  end_date: string;
  days: Record<string, { totals: Macros; daily_goals: Macros | null }>;
  totals: Macros;
};

export type McpWeighinsResult = {
  user_id: number;
  weighins: WeightEntry[];
  next_offset: number | null;
};

export type WeightSummaryPoint = Pick<WeightEntry, 'local_date' | 'weight_kg'>;

export type SummaryResult = {
  days_total: number;
  days_logged: number;
  days_without_entries: number;
  totals: Macros;
  // Days with at least one entry, including zero-calorie entries. This does
  // not imply complete logging; null means there were no logged days.
  average_on_logged_days: Macros | null;
  weight: {
    weighin_count: number;
    first: WeightSummaryPoint | null;
    last: WeightSummaryPoint | null;
    // Latest minus earliest within the range; null with fewer than two points.
    change_kg: number | null;
  };
};

export type McpSummaryResult = SummaryResult & {
  user_id: number;
  start_date: string;
  end_date: string;
  goal_periods: GoalPeriod[];
  goal_comparison: GoalComparison;
};

export type McpProductSearchResult = {
  user_id: number;
  products: Product[];
  template: ProductTemplate | null;
  next_offset: number | null;
};

export type McpCreationReceipt = {
  idempotency_key: string;
  applied_at: string;
  replayed: boolean;
};
export type McpEntriesCreateResult = {
  user_id: number;
  entries: McpEntry[];
  group: EntryGroup | null;
  totals: Macros;
  receipt: McpCreationReceipt;
};

// MCP mutation results omit app-only food checkmarks and report deletion effects.
export type McpEntryWriteResult = {
  user_id: number;
  entry: McpEntry;
};

export type McpEntryDeleteResult = {
  user_id: number;
  ok: true;
  entry_id: number;
  dissolved_group_id: number | null;
};

export type McpProductWriteResult = {
  user_id: number;
  product: Product;
};
export type McpProductCreateResult = McpProductWriteResult & { receipt: McpCreationReceipt };

export type McpProductDeleteResult = {
  user_id: number;
  ok: true;
  product_id: number;
  deleted_entry_count: number;
};

export type EntryGroupResult = {
  group: EntryGroup;
  entries: EntryWithMacros[];
};

export type McpEntryGroupResult = Omit<EntryGroupResult, 'entries'> & { user_id: number; entries: McpEntry[] };
export type McpEntryGroupCreateResult = McpEntryGroupResult & { receipt: McpCreationReceipt };

export type UngroupResult = {
  ok: true;
  group_id: number;
  entries: EntryWithMacros[];
};

export type McpUngroupResult = Omit<UngroupResult, 'entries'> & { user_id: number; entries: McpEntry[] };

export type EntryGroupDeleteResult = {
  ok: true;
  group_id: number;
  deleted_entry_ids: number[];
};

export type McpEntryGroupDeleteResult = EntryGroupDeleteResult & { user_id: number };
