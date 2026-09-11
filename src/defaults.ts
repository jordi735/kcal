import type { Goals } from './types';

// Initial display values when no cached user exists. Once authenticated,
// GET /settings remains authoritative.
export const DEFAULT_GOALS: Goals = {
  kcal: 2400,
  protein: 180,
  carbs: 240,
  fat: 80,
};
