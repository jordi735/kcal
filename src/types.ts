export type {
  User,
  VerifyCodeResponse,
  NewEntryBody,
  NewProductBody,
  UpdateProductBody,
  Macros,
  SettingsSnapshot,
  GoalHistoryItem,
  SettingsSaveResult,
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
} from '../shared/types.js';

import type { Macros } from '../shared/types.js';

// Preserve the existing import surface while keeping runtime calculations in
// the macro module.
export { sumMacros } from './macros';

export type Goals = Macros;
