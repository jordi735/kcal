// The picker order and stable saved IDs. Palette values live only in themes.css.
export const THEMES = [
  { id: 'carbon', name: 'Carbon' },
  { id: 'paper', name: 'Paper' },
  { id: 'midnight', name: 'Midnight' },
  { id: 'catppuccin-mocha', name: 'Catppuccin Mocha' },
  { id: 'jungle-radio', name: 'Jungle Radio' },
  { id: 'cherry-cola', name: 'Cherry Cola' },
  { id: 'saffron-milk', name: 'Saffron Milk' },
  { id: 'cobalt-crush', name: 'Cobalt Crush' },
  { id: 'matcha', name: 'Matcha' },
  { id: 'poolside', name: 'Poolside' },
  { id: 'guava', name: 'Guava' },
  { id: 'arcade', name: 'Arcade' },
  { id: 'lagoon', name: 'Lagoon' },
  { id: 'rose-pine-dawn', name: 'Rosé Pine Dawn' },
  { id: 'gruvbox', name: 'Gruvbox' },
  { id: 'dracula', name: 'Dracula' },
] as const;

export type ThemeId = typeof THEMES[number]['id'];
export const DEFAULT_THEME: ThemeId = 'carbon';
export const THEME_STORAGE_KEY = 'kcal_theme';

export function resolveTheme(value: unknown): ThemeId {
  return THEMES.find((theme) => theme.id === value)?.id ?? DEFAULT_THEME;
}
