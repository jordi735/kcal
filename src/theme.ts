import { DEFAULT_THEME, resolveTheme, THEME_STORAGE_KEY, type ThemeId } from './themes';

let selectedTheme: ThemeId = DEFAULT_THEME;
const listeners = new Set<(theme: ThemeId) => void>();

function applyTheme(theme: ThemeId): void {
  selectedTheme = theme;
  const root = document.documentElement;
  root.dataset.theme = theme;
  const palette = getComputedStyle(root);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', palette.getPropertyValue('--bg').trim());
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', palette.colorScheme);
  for (const listener of listeners) listener(theme);
}

function onStorage(event: StorageEvent): void {
  // Ignore sessionStorage events; clearing localStorage also resets appearance.
  if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
  try {
    if (event.storageArea !== window.localStorage) return;
    // Read the latest preference: a queued event may precede a newer selection.
    applyTheme(resolveTheme(localStorage.getItem(THEME_STORAGE_KEY)));
  } catch { /* Keep the current palette if storage access has been revoked. */ }
}

// Runs before render, independently of authentication. The head bootstrap has
// already selected the first-paint palette; never reset it in a mount effect.
export function initializeTheme(): () => void {
  let theme = resolveTheme(document.documentElement.dataset.theme);
  try {
    // A different tab may have changed the preference while the app was loading.
    theme = resolveTheme(localStorage.getItem(THEME_STORAGE_KEY));
  } catch { /* Keep the bootstrap palette when storage is unavailable. */ }
  applyTheme(theme);
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}

export function getTheme(): ThemeId {
  return selectedTheme;
}

export function selectTheme(theme: ThemeId): void {
  const next = resolveTheme(theme);
  applyTheme(next);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch { /* Selection still works for this page when persistence is blocked. */ }
}

export function subscribeTheme(listener: (theme: ThemeId) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
