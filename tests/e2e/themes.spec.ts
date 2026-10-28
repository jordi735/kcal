import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { DEFAULT_THEME, THEMES, THEME_STORAGE_KEY, type ThemeId } from '../../src/themes';
import type { SettingsSnapshot, User } from '../../src/types';
import { deferred } from './app-refresh-helpers';

test.use({ storageState: { cookies: [], origins: [] }, timezoneId: 'UTC' });

const goals = { kcal: 2000, protein: 100, carbs: 200, fat: 70 };
const settings: SettingsSnapshot = {
  ...goals,
  goal_history: [{ effective_date: '2026-01-01', goals }],
  mcp_notice_version: null,
};
const user: User = {
  id: 1, email: 'themes@test.local', goal_kcal: goals.kcal,
  goal_protein: goals.protein, goal_carbs: goals.carbs, goal_fat: goals.fat,
};

async function mockApp(context: BrowserContext) {
  const state = { settingsWrites: [] as unknown[] };
  await context.route('**/*', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/settings') {
      if (request.method() !== 'GET') state.settingsWrites.push(request.postDataJSON());
      await route.fulfill({ json: settings });
    } else if (path === '/entries' || path === '/weights') {
      await route.fulfill({ json: [] });
    } else if (path === '/entries/week') {
      await route.fulfill({ json: {} });
    } else if (path === '/auth/logout') {
      await route.fulfill({ json: { ok: true } });
    } else {
      await route.fallback();
    }
  });
  return state;
}

type BootstrapOptions = {
  storedTheme?: string;
  authenticated?: boolean;
  denyThemeStorage?: 'read' | 'write';
};

async function preparePage(page: Page, options: BootstrapOptions = {}) {
  await page.addInitScript(({ cachedUser, key, initial }) => {
    // Seed each tab once, so reloads and logout exercise real persisted state.
    if (sessionStorage.getItem('kcal_theme_test_seeded') === null) {
      sessionStorage.setItem('kcal_theme_test_seeded', '1');
      if (initial.authenticated !== false) {
        localStorage.setItem('kcal_session_token', 'theme-test-session');
        localStorage.setItem('kcal_user', JSON.stringify(cachedUser));
      }
      if (initial.storedTheme !== undefined) localStorage.setItem(key, initial.storedTheme);
    }
    // Deny only theme access: an authentication failure would hide the feature
    // under test instead of exercising its storage-error handling.
    if (initial.denyThemeStorage === 'read') {
      const getItem = Storage.prototype.getItem;
      Storage.prototype.getItem = function (this: Storage, name: string) {
        if (this === localStorage && name === key) throw new DOMException('Theme storage denied', 'SecurityError');
        return getItem.call(this, name);
      };
    }
    if (initial.denyThemeStorage === 'write') {
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (this: Storage, name: string, value: string) {
        if (this === localStorage && name === key) throw new DOMException('Theme storage denied', 'QuotaExceededError');
        setItem.call(this, name, value);
      };
    }
  }, { cachedUser: user, key: THEME_STORAGE_KEY, initial: options });
}

async function boot(page: Page, options: BootstrapOptions = {}) {
  await preparePage(page, options);
  await page.goto('/');
  if (options.authenticated === false) {
    await expect(page.getByPlaceholder('you@example.com')).toBeVisible();
  } else {
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
    await expect(page.getByText('/ 2000', { exact: true })).toBeVisible();
  }
}

const sheet = (page: Page) => page.locator('.sheet');
const themeGroup = (page: Page) => sheet(page).getByRole('group', { name: 'Themes', exact: true });
function themeRadio(page: Page, id: ThemeId) {
  const theme = THEMES.find((candidate) => candidate.id === id);
  if (theme === undefined) throw new Error(`Missing theme ${id}`);
  return sheet(page).getByRole('radio', { name: theme.name, exact: true });
}

async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).tap();
  await expect(sheet(page).getByRole('button', { name: 'Save', exact: true })).toBeVisible();
}

async function openThemes(page: Page) {
  await sheet(page).getByRole('button', { name: 'Themes', exact: true }).tap();
  await expect(sheet(page).getByRole('heading', { name: 'Themes', level: 2 })).toBeVisible();
  await expect(themeGroup(page)).toBeVisible();
  await expect(sheet(page)).toHaveCount(1);
  await expect(sheet(page).locator('[data-sheet-scroll]')).toHaveCount(1);
  await expect(sheet(page).locator('[data-sheet-scroll]')).toBeVisible();
}

async function selectTheme(page: Page, id: ThemeId) {
  const radio = themeRadio(page, id);
  await radio.locator('..').tap();
  await expect(radio).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-theme', id);
}

async function storedTheme(page: Page) {
  return page.evaluate((key) => localStorage.getItem(key), THEME_STORAGE_KEY);
}

test('[J-488] choosing a theme applies immediately and survives Settings cancel reload and sign out', async ({ page, context }) => {
  const state = await mockApp(context);
  await boot(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', DEFAULT_THEME);
  await openSettings(page);
  await openThemes(page);
  await expect(themeRadio(page, DEFAULT_THEME)).toBeChecked();
  await selectTheme(page, 'paper');
  expect(await storedTheme(page)).toBe('paper');
  await expect(sheet(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  await sheet(page).getByRole('button', { name: 'Back', exact: true }).tap();
  await sheet(page).getByRole('button', { name: 'Cancel', exact: true }).tap();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'paper');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'paper');
  await openSettings(page);
  await openThemes(page);
  await expect(themeRadio(page, 'paper')).toBeChecked();
  await sheet(page).getByRole('button', { name: 'Back', exact: true }).tap();
  await sheet(page).getByRole('button', { name: 'Sign out', exact: true }).tap();
  await expect(page.getByPlaceholder('you@example.com')).toBeVisible();
  expect(await storedTheme(page)).toBe('paper');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'paper');
  await page.reload();
  await expect(page.getByPlaceholder('you@example.com')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'paper');
  expect(state.settingsWrites).toEqual([]);
});

test('[J-489] another tab changes the active theme and removal or storage clear restores Carbon', async ({ page, context }) => {
  await mockApp(context);
  await boot(page);
  await openSettings(page);
  await openThemes(page);
  const other = await context.newPage();
  try {
    await boot(other);
    await openSettings(other);
    await openThemes(other);
    await selectTheme(other, 'catppuccin-mocha');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'catppuccin-mocha');
    await expect(themeRadio(page, 'catppuccin-mocha')).toBeChecked();

    // A queued event describes an earlier selection; the persisted value is
    // authoritative when the receiver processes it.
    await page.evaluate((key) => window.dispatchEvent(new StorageEvent('storage', {
      key, oldValue: 'carbon', newValue: 'paper', storageArea: localStorage,
    })), THEME_STORAGE_KEY);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'catppuccin-mocha');
    await expect(themeRadio(page, 'catppuccin-mocha')).toBeChecked();

    await other.evaluate((key) => localStorage.removeItem(key), THEME_STORAGE_KEY);
    await expect(page.locator('html')).toHaveAttribute('data-theme', DEFAULT_THEME);
    await expect(themeRadio(page, DEFAULT_THEME)).toBeChecked();

    await selectTheme(other, 'paper');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'paper');
    await expect(themeRadio(page, 'paper')).toBeChecked();
    await other.evaluate(() => localStorage.clear());
    await expect(page.locator('html')).toHaveAttribute('data-theme', DEFAULT_THEME);
    await expect(page.getByPlaceholder('you@example.com')).toBeVisible();
  } finally { await other.close(); }
});

test('[J-490] unknown empty and malformed saved theme IDs fall back to the usable Carbon picker', async ({ context }) => {
  await mockApp(context);
  for (const invalid of ['future-theme', 'forest', '', '{"id":"paper"}']) {
    const page = await context.newPage();
    try {
      await boot(page, { storedTheme: invalid });
      await expect(page.locator('html')).toHaveAttribute('data-theme', DEFAULT_THEME);
      await openSettings(page);
      await openThemes(page);
      await expect(themeRadio(page, DEFAULT_THEME)).toBeChecked();
      await selectTheme(page, 'midnight');
      expect(await storedTheme(page)).toBe('midnight');
    } finally { await page.close(); }
  }
});

async function canvasColors(page: Page) {
  return page.evaluate(() => {
    const root = document.getElementById('root');
    if (root === null) throw new Error('Missing app root');
    return {
      html: getComputedStyle(document.documentElement).backgroundColor,
      body: getComputedStyle(document.body).backgroundColor,
      root: getComputedStyle(root).backgroundColor,
    };
  });
}

test('[J-491] saved Paper paints the real canvas before the production app module executes', async ({ page, context }) => {
  await mockApp(context);
  const reference = await context.newPage();
  const requested = deferred();
  const release = deferred();
  try {
    await boot(reference, { storedTheme: 'paper', authenticated: false });
    const expected = await canvasColors(reference);
    expect(expected.html).not.toBe('rgb(0, 0, 0)');
    expect(expected.html).not.toBe('rgba(0, 0, 0, 0)');
    expect(expected.body).toBe(expected.html);
    expect(expected.root).toBe(expected.html);

    await preparePage(page, { authenticated: false });
    await page.route('**/assets/*.js', async (route) => {
      requested.resolve();
      await release.promise;
      await route.continue();
    });
    await page.goto('/', { waitUntil: 'commit' });
    await requested.promise;
    await expect(page.locator('#root')).toBeEmpty();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'paper');
    await expect.poll(() => canvasColors(page)).toEqual(expected);
    await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
  } finally {
    release.resolve();
    await reference.close();
  }
  await expect(page.getByPlaceholder('you@example.com')).toBeVisible();
});

test.describe('desktop theme keyboard', () => {
  test.use({ viewport: { width: 1280, height: 900 }, isMobile: false });

  test('[J-492] keyboard theme selection preserves goal drafts restores focus and survives dismissal', async ({ page, context }) => {
    const state = await mockApp(context);
    await boot(page);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const inputs = sheet(page).getByRole('spinbutton');
    const draft = ['111', '222', '33', '1888'];
    for (const [index, value] of draft.entries()) await inputs.nth(index).fill(value);
    const original = await inputs.first().elementHandle();
    if (original === null) throw new Error('Missing goal input');
    const launcher = sheet(page).getByRole('button', { name: 'Themes', exact: true });
    await launcher.focus();
    await page.keyboard.press('Enter');
    await expect(sheet(page).getByRole('heading', { name: 'Themes', level: 2 })).toBeFocused();
    expect(await original.evaluate((input) => input.isConnected)).toBe(true);
    await expect(inputs).toHaveCount(0);
    await expect(sheet(page).locator('[data-sheet-scroll]')).toHaveCount(1);

    await page.keyboard.press('Tab');
    await expect(sheet(page).getByRole('button', { name: 'Back', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(themeRadio(page, DEFAULT_THEME)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    const next = THEMES[1];
    if (next === undefined) throw new Error('A second theme is required');
    await expect(themeRadio(page, next.id)).toBeFocused();
    await expect(themeRadio(page, next.id)).toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-theme', next.id);
    expect(await storedTheme(page)).toBe(next.id);

    // Wrap to the last option, which is below the fold in the full catalog.
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    const last = THEMES.at(-1);
    if (last === undefined) throw new Error('A final theme is required');
    await expect(themeRadio(page, last.id)).toBeFocused();
    await expect(themeRadio(page, last.id)).toBeChecked();
    await expect(themeRadio(page, last.id).locator('..')).toBeInViewport();
    await expect(page.locator('html')).toHaveAttribute('data-theme', last.id);
    expect(await storedTheme(page)).toBe(last.id);

    await sheet(page).getByRole('button', { name: 'Back', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(launcher).toBeFocused();
    for (const [index, value] of draft.entries()) await expect(inputs.nth(index)).toHaveValue(value);
    await page.keyboard.press('Enter');
    await expect(sheet(page).getByRole('heading', { name: 'Themes', level: 2 })).toBeVisible();
    await page.locator('.overlay').dispatchEvent('click');
    await expect(sheet(page)).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('data-theme', last.id);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    for (const [index, value] of ['100', '200', '70', '2000'].entries()) {
      await expect(inputs.nth(index)).toHaveValue(value);
    }
    expect(state.settingsWrites).toEqual([]);
  });
});

// Visual compatibility contract for the original Carbon palette. Keep these
// values independent of the theme definitions so a palette regression is visible.
const CARBON_COLORS = {
  '--bg': '#000000', '--bg-elev': '#101214', '--bg-elev-2': '#191c20',
  '--border': '#282d34', '--border-strong': '#414a56', '--fg': '#e6e9ee',
  '--fg-dim': '#afb7c3', '--fg-dimmer': '#8993a2', '--accent': '#c9d5e3',
  '--accent-ink': '#000000', '--danger': '#ff8580', '--kcal': '#70bbff',
  '--macro-p': '#feb13d', '--macro-c': '#2cb9b1', '--macro-f': '#c677e2',
  '--kcal-dim': '#527fae', '--macro-p-dim': '#ae7d33',
  '--macro-c-dim': '#25827e', '--macro-f-dim': '#925ca8',
};
const THEME_TOKENS = [...Object.keys(CARBON_COLORS), '--danger-ink', '--overlay', '--scanner-overlay'];

function rgb(hex: string) {
  return `rgb(${[1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16)).join(', ')})`;
}

test('[J-493] palettes style live overlays preserve Carbon colors and update Paper native controls', async ({ page, context }) => {
  // Each catalog entry visits Settings and a live scanner overlay.
  test.slow();
  await mockApp(context);
  await page.route(/\/products\/(?:recent|all)$/, (route) => route.fulfill({ json: [] }));
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => { throw new DOMException('Camera fixture error', 'NotAllowedError'); },
    });
  });
  await boot(page);
  await openSettings(page);
  // Moving the entire global stylesheet into the head reversed its precedence
  // over CSS modules. Keep the original visible type as well as palette colors.
  await expect(sheet(page).getByText('per day', { exact: true }).first()).toHaveCSS('font-size', '10px');
  await expect(sheet(page).getByRole('button', { name: 'Save', exact: true })).toHaveCSS('letter-spacing', '1.2px');
  await openThemes(page);
  expect(new Set(THEMES.map((theme) => theme.id)).size).toBe(THEMES.length);
  await expect(themeGroup(page).getByRole('radio')).toHaveCount(THEMES.length);
  for (const theme of THEMES) {
    await selectTheme(page, theme.id);
    const actual = await page.evaluate(({ id, keys }) => {
      const declarations = new Set<string>();
      const paletteIds = new Set<string>();
      const visit = (rules: CSSRuleList) => {
        for (const rule of Array.from(rules)) {
          if (rule instanceof CSSStyleRule) {
            const ids = Array.from(rule.selectorText.matchAll(/\[data-theme\s*=\s*["']?([^"'\]\s]+)["']?\]/g), (match) => match[1]);
            for (const paletteId of ids) if (paletteId !== undefined) paletteIds.add(paletteId);
            if (ids.includes(id)) {
              for (const key of Array.from(rule.style)) declarations.add(key);
            }
          } else if (rule instanceof CSSImportRule && rule.styleSheet !== null) {
            try { visit(rule.styleSheet.cssRules); } catch { /* Cross-origin font styles. */ }
          } else if ('cssRules' in rule) {
            visit((rule as CSSGroupingRule).cssRules);
          }
        }
      };
      for (const styleSheet of Array.from(document.styleSheets)) {
        try { visit(styleSheet.cssRules); } catch { /* Cross-origin font styles. */ }
      }
      const style = getComputedStyle(document.documentElement);
      const probe = document.createElement('span');
      document.body.append(probe);
      const colors: Record<string, string> = {};
      const invalid: string[] = [];
      for (const key of keys) {
        const value = style.getPropertyValue(key).trim();
        if (!value || !CSS.supports('color', value)) invalid.push(key);
        probe.style.color = value;
        colors[key] = getComputedStyle(probe).color;
      }
      probe.style.color = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content ?? '';
      const chrome = getComputedStyle(probe).color;
      // Both original Carbon overlays rendered as black at 60% opacity: the
      // shared .overlay rule previously overrode the scanner module's 92%.
      probe.style.color = 'color-mix(in oklab, #000000 60%, transparent)';
      const originalCarbonOverlay = getComputedStyle(probe).color;
      probe.remove();
      return {
        // The production CSS transform adds private color-scheme helpers.
        declaredTokens: [...declarations].filter((key) => key.startsWith('--') && !key.startsWith('--lightningcss-')).sort(),
        invalid, colors, chrome, originalCarbonOverlay,
        scheme: style.colorScheme, paletteIds: [...paletteIds].sort(),
      };
    }, { id: theme.id, keys: THEME_TOKENS });
    expect(actual.paletteIds).toEqual(THEMES.map((item) => item.id).sort());
    expect(actual.declaredTokens, `${theme.id} must declare exactly the complete palette`).toEqual([...THEME_TOKENS].sort());
    expect(actual.invalid, `${theme.id} tokens must be usable colors`).toEqual([]);
    expect(actual.chrome).toBe(actual.colors['--bg']);
    expect(['light', 'dark']).toContain(actual.scheme);
    await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute('content', actual.scheme);
    if (theme.id === 'paper') expect(actual.scheme).toBe('light');
    if (theme.id === DEFAULT_THEME) {
      expect(actual.scheme).toBe('dark');
      for (const [key, value] of Object.entries(CARBON_COLORS)) expect(actual.colors[key], key).toBe(rgb(value));
    }

    const overlay = page.locator('.overlay');
    await expect(overlay).toHaveCount(1);
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveCSS('background-color', actual.colors['--overlay']!);
    if (theme.id === DEFAULT_THEME) {
      await expect(overlay).toHaveCSS('background-color', actual.originalCarbonOverlay);
    }
    await sheet(page).getByRole('button', { name: 'Back', exact: true }).tap();
    await sheet(page).getByRole('button', { name: 'Cancel', exact: true }).tap();
    await expect(sheet(page)).toHaveCount(0);
    await expect(overlay).toHaveCount(0);

    await page.getByRole('button', { name: 'ADD FOOD', exact: true }).tap();
    await sheet(page).getByRole('button', { name: 'Scan barcode', exact: true }).tap();
    await expect(page.getByText('Camera access denied.', { exact: true })).toBeVisible();
    await expect(sheet(page)).toHaveCount(0);
    await expect(overlay).toHaveCount(1);
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveCSS('background-color', actual.colors['--scanner-overlay']!);
    if (theme.id === DEFAULT_THEME) {
      await expect(overlay).toHaveCSS('background-color', actual.originalCarbonOverlay);
    }
    await page.getByRole('button', { name: 'Close', exact: true }).tap();
    await expect(page.getByText('SCAN BARCODE', { exact: true })).toHaveCount(0);
    await expect(sheet(page).getByText('Add Food', { exact: true })).toBeVisible();
    await overlay.dispatchEvent('click');
    await expect(sheet(page)).toHaveCount(0);
    await openSettings(page);
    await openThemes(page);
  }

  await selectTheme(page, 'paper');
  await sheet(page).getByRole('button', { name: 'Back', exact: true }).tap();
  await sheet(page).getByRole('button', { name: 'Cancel', exact: true }).tap();
  await expect(sheet(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Weights', exact: true }).tap();
  await sheet(page).getByRole('button', { name: 'Add weight', exact: true }).tap();
  await expect(sheet(page).getByLabel('Date', { exact: true })).toHaveCSS('color-scheme', 'light');
  await expect(sheet(page).getByRole('checkbox')).toHaveCount(2);
  for (const checkbox of await sheet(page).getByRole('checkbox').all()) await expect(checkbox).toHaveCSS('color-scheme', 'light');
});

test('[J-494] denied theme storage reads fall back to Carbon without breaking auth or live selection', async ({ page, context }) => {
  const state = await mockApp(context);
  await boot(page, { storedTheme: 'paper', denyThemeStorage: 'read' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', DEFAULT_THEME);
  await openSettings(page);
  await expect(sheet(page).getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await openThemes(page);
  await selectTheme(page, 'catppuccin-mocha');
  await sheet(page).getByRole('button', { name: 'Back', exact: true }).tap();
  await expect(sheet(page).getByRole('spinbutton').last()).toHaveValue('2000');
  await expect(sheet(page).getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  expect(state.settingsWrites).toEqual([]);
});

test('[J-495] denied theme storage writes keep live selection usable without pretending it persisted', async ({ page, context }) => {
  const state = await mockApp(context);
  await boot(page, { storedTheme: DEFAULT_THEME, denyThemeStorage: 'write' });
  await openSettings(page);
  await openThemes(page);
  await selectTheme(page, 'paper');
  expect(await storedTheme(page)).toBe(DEFAULT_THEME);
  await sheet(page).getByRole('button', { name: 'Back', exact: true }).tap();
  await expect(sheet(page).getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', DEFAULT_THEME);
  await openSettings(page);
  await openThemes(page);
  await selectTheme(page, 'midnight');
  expect(state.settingsWrites).toEqual([]);
});
