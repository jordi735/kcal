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
  McpEntryGroupResult,
  McpUngroupResult,
  McpEntryGroupDeleteResult,
} from '../shared/types.js';

import type { Macros } from '../shared/types.js';

// Preserve the existing import surface while keeping runtime calculations in
// the macro module.
export { sumMacros } from './macros';

export type Goals = Macros;

export type User = {
  id: number;
  email: string;
  goal_kcal: number;
  goal_protein: number;
  goal_carbs: number;
  goal_fat: number;
};
