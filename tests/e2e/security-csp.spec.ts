import { test, expect, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deferred, frame } from './app-refresh-helpers';
import { runServerFixture, serverFixtureEnvironment } from './server-fixture';
import type { CspServerReady } from './fixtures/security-csp-server';
import type { CspModeResult } from './fixtures/security-csp-mode';

test.use({ storageState: { cookies: [], origins: [] } });

type Violation = { directive: string; blocked: string; disposition: string };
declare global {
  interface Window {
    __cspViolations: Violation[];
    __cspProbe?: { inline: boolean; handler: boolean; eval: boolean; evalBlocked: boolean; done: boolean };
  }
}

async function withCspServer(overrides: Record<string, string>, run: (origin: string) => Promise<void>): Promise<void> {
  const child = spawn(process.execPath,
    ['--import', 'tsx', fileURLToPath(new URL('./fixtures/security-csp-server.ts', import.meta.url))], {
      cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
      env: serverFixtureEnvironment(':memory:', {
        APP_ENV: 'production', TEST_MODE: 'false', LOG_LEVEL: 'error', ...overrides,
      }, { inheritEnv: false }),
    });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', data => { stdout += data.toString(); });
  child.stderr.on('data', data => { stderr += data.toString(); });
  const exited = once(child, 'exit');
  try {
    await expect.poll(() => stdout.includes('CSP_READY ') || child.exitCode !== null,
      { timeout: 10_000, message: 'CSP fixture must become ready or fail within ten seconds' }).toBe(true);
    expect(child.exitCode, stderr).toBeNull();
    const line = stdout.split('\n').find(value => value.startsWith('CSP_READY '));
    expect(line, stdout + stderr).toBeDefined();
    const ready = JSON.parse(line!.slice('CSP_READY '.length)) as CspServerReady;
    expect(new URL(ready.origin).hostname).toBe('127.0.0.1');
    await run(ready.origin);
  } finally {
    const force = setTimeout(() => child.kill('SIGKILL'), 5000);
    force.unref();
    try {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      await exited;
    } finally { clearTimeout(force); }
  }
}

function policyFor(html: string): Record<string, string[]> {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  const inline = scripts.filter(match => !/\bsrc\s*=/i.test(match[1]!));
  expect(inline).toHaveLength(1);
  const body = inline[0]![2]!;
  expect(body).toContain("localStorage.getItem('kcal_theme')");
  const hash = createHash('sha256').update(body).digest('base64');
  return {
    'default-src': ["'self'"],
    'script-src': ["'self'", `'sha256-${hash}'`],
    'style-src': ["'self'", 'https://fonts.googleapis.com'],
    'style-src-attr': ["'none'"],
    'font-src': ["'self'", 'https://fonts.gstatic.com'],
    'img-src': ["'self'", 'data:'],
    'connect-src': ["'self'"],
    'media-src': ["'self'", 'blob:'],
    'worker-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'frame-ancestors': ["'none'"],
    'form-action': ["'self'"],
  };
}

function parsedPolicy(value: string | undefined): Record<string, string[]> {
  expect(value, 'The real response must carry a CSP header').toBeTruthy();
  const directives = value!.split(';').map(value => value.trim().split(/\s+/)).filter(parts => parts[0]);
  expect(new Set(directives.map(parts => parts[0])).size, 'Duplicate CSP directives').toBe(directives.length);
  return Object.fromEntries(directives.map(([name, ...sources]) => [name!, sources]));
}

async function observeCsp(page: Page): Promise<void> {
  // Functional policy tests do not assert font metrics. The separate pinned
  // visual harness fulfills frozen real Google CSS/WOFF bytes for those checks.
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', event => {
      window.__cspViolations.push({ directive: event.effectiveDirective, blocked: event.blockedURI,
        disposition: event.disposition });
    });
  });
}

test('[J-531] production CSP hashes the served bootstrap and preserves every palette before app execution', async ({ browser, request }) => {
  test.setTimeout(60_000);
  await withCspServer({}, async origin => {
    const document = await request.get(origin);
    expect(document.status()).toBe(200);
    const html = await document.text();
    expect(parsedPolicy(document.headers()['content-security-policy'])).toEqual(policyFor(html));
    expect(document.headers()['content-security-policy-report-only']).toBeUndefined();
    const directIndex = await request.get(origin + '/index.html');
    expect(await directIndex.text()).toBe(html);
    expect(directIndex.headers()['content-security-policy']).toBe(document.headers()['content-security-policy']);
    const encodedIndex = await request.get(origin + '/%69ndex.html');
    expect(await encodedIndex.text()).toBe(html);
    expect(encodedIndex.headers()['content-security-policy']).toBe(document.headers()['content-security-policy']);

    const cases = [
      { stored: 'carbon', resolved: 'carbon', color: 'rgb(0, 0, 0)', scheme: 'dark' },
      { stored: 'paper', resolved: 'paper', color: 'rgb(245, 241, 232)', scheme: 'light' },
      { stored: 'midnight', resolved: 'midnight', color: 'rgb(9, 17, 31)', scheme: 'dark' },
      { stored: 'catppuccin-mocha', resolved: 'catppuccin-mocha', color: 'rgb(30, 30, 46)', scheme: 'dark' },
      { stored: null, resolved: 'carbon', color: 'rgb(0, 0, 0)', scheme: 'dark' },
      { stored: 'future-theme', resolved: 'carbon', color: 'rgb(0, 0, 0)', scheme: 'dark' },
      { stored: 'paper', resolved: 'carbon', color: 'rgb(0, 0, 0)', scheme: 'dark', denyRead: true },
    ];
    for (const initial of cases) {
      const context = await browser.newContext({ viewport: { width: 412, height: 915 } });
      const page = await context.newPage();
      let requested = false;
      const release = deferred();
      try {
        await observeCsp(page);
        await page.addInitScript(({ stored, denyRead }) => {
          if (stored === null) localStorage.removeItem('kcal_theme');
          else localStorage.setItem('kcal_theme', stored);
          if (denyRead) {
            const getItem = Storage.prototype.getItem;
            Storage.prototype.getItem = function (this: Storage, key: string) {
              if (this === localStorage && key === 'kcal_theme') throw new DOMException('Fixture storage denied', 'SecurityError');
              return getItem.call(this, key);
            };
          }
        }, { stored: initial.stored, denyRead: initial.denyRead ?? false });
        await page.route('**/assets/*.js', async route => {
          requested = true;
          await release.promise;
          await route.continue();
        });
        const navigation = await page.goto(origin, { waitUntil: 'commit' });
        expect(navigation).not.toBeNull();
        expect(parsedPolicy((await navigation!.allHeaders())['content-security-policy'])).toEqual(policyFor(html));
        await expect.poll(() => requested, { timeout: 10_000 }).toBe(true);
        await expect(page.locator('#root')).toBeEmpty();
        for (const selector of ['html', 'body', '#root']) {
          await expect(page.locator(selector), initial.stored ?? 'missing preference').toHaveCSS('background-color', initial.color);
        }
        await expect(page.locator('html')).toHaveCSS('color-scheme', initial.scheme);
        expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);
        release.resolve();
        await expect(page.getByPlaceholder('you@example.com')).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('data-theme', initial.resolved);
        await page.waitForLoadState('load');
        if (initial.stored === 'carbon') {
          await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.scriptURL))
            .toBe(origin + '/sw.js');
          expect(await page.evaluate(() => caches.keys())).toEqual([]);
        }
        await frame(page);
        expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);
      } finally {
        release.resolve();
        await context.close();
      }
    }
  });
});

test('[J-532] CSP mode defaults enforce outside development and production cannot disable protection', async ({ request }) => {
  test.setTimeout(60_000);
  const allowed = [
    { app: 'production', requested: undefined, expected: 'enforce' },
    { app: 'test', requested: undefined, expected: 'enforce' },
    { app: 'development', requested: undefined, expected: 'off' },
    { app: 'production', requested: 'report-only', expected: 'report-only' },
    { app: 'production', requested: 'enforce', expected: 'enforce' },
    { app: 'test', requested: 'off', expected: 'off' },
    { app: 'development', requested: 'off', expected: 'off' },
    { app: 'development', requested: 'enforce', expected: 'enforce' },
  ];
  for (const mode of allowed) {
    const overrides: Record<string, string> = { APP_ENV: mode.app, TEST_MODE: 'false' };
    if (mode.requested !== undefined) overrides.CSP_MODE = mode.requested;
    const child = runServerFixture(new URL('./fixtures/security-csp-mode.ts', import.meta.url), ':memory:', overrides,
      { inheritEnv: false, timeoutMs: 8000 });
    expect(child.status, child.stderr).toBe(0);
    const line = child.stdout.split('\n').find(value => value.startsWith('CSP_MODE_RESULT '));
    expect(line, child.stdout).toBeDefined();
    const result = JSON.parse(line!.slice('CSP_MODE_RESULT '.length)) as CspModeResult;
    expect(result).toEqual({ appEnv: mode.app, mode: mode.expected });
  }
  for (const mode of ['off', 'typo']) {
    const directory = await mkdtemp(join(tmpdir(), 'kcal-csp-mode-'));
    const database = join(directory, 'not-created', 'app.db');
    try {
      const child = runServerFixture(new URL('./fixtures/security-csp-mode.ts', import.meta.url), database,
        { APP_ENV: 'production', TEST_MODE: 'false', CSP_MODE: mode }, { inheritEnv: false, timeoutMs: 8000 });
      expect(child.status, child.stdout + child.stderr).toBe(1);
      expect(child.stderr).toContain('CSP_MODE');
      expect(existsSync(join(directory, 'not-created'))).toBe(false);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  await withCspServer({ CSP_MODE: 'report-only' }, async origin => {
    const response = await request.get(origin);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-security-policy']).toBeUndefined();
    expect(parsedPolicy(response.headers()['content-security-policy-report-only'])).toEqual(policyFor(await response.text()));
  });
});

test('[J-533] enforced CSP blocks unauthorized inline scripts event handlers and eval', async ({ browser }) => {
  // A controlling worker can bypass Playwright request routing in WebKit. This
  // probe needs a routed same-origin script; J-531 separately exercises the real
  // service worker under the same enforced policy.
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  try {
    await withCspServer({}, async origin => {
      await observeCsp(page);
      await page.route('**/csp-probe.js', route => route.fulfill({ contentType: 'text/javascript', body: `
        window.__cspProbe = { inline: false, handler: false, eval: false, evalBlocked: false, done: false };
        const script = document.createElement('script');
        script.textContent = 'window.__cspProbe.inline = true';
        document.body.append(script);
        const button = document.createElement('button');
        button.setAttribute('onclick', 'window.__cspProbe.handler = true');
        document.body.append(button);
        button.click();
        try { eval('window.__cspProbe.eval = true'); }
        catch { window.__cspProbe.evalBlocked = true; }
        window.__cspProbe.done = true;
      ` }));
      await page.goto(origin);
      await expect(page.getByPlaceholder('you@example.com')).toBeVisible();
      expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);
      // Load the probe as ordinary same-origin script. Evaluating eval directly
      // through DevTools/Playwright can bypass the very CSP constraint under test.
      await page.evaluate(() => {
        const script = document.createElement('script');
        script.src = '/csp-probe.js';
        document.body.append(script);
      });
      await expect.poll(() => page.evaluate(() => window.__cspProbe)).toEqual({
        inline: false, handler: false, eval: false, evalBlocked: true, done: true,
      });
      await expect.poll(() => page.evaluate(() => window.__cspViolations.map(value => value.blocked)))
        .toEqual(expect.arrayContaining(['inline', 'eval']));
      const violations = await page.evaluate(() => window.__cspViolations);
      expect(violations.some(value => value.directive === 'script-src-attr')).toBe(true);
      expect(violations.every(value => value.disposition === 'enforce')).toBe(true);
    });
  } finally { await context.close(); }
});

test('[J-534] the clean production build contains no source maps or source-map references', async () => {
  const files = await readdir('dist', { recursive: true, withFileTypes: true });
  const artifacts = files.filter(file => file.isFile());
  expect(artifacts.some(file => file.name.endsWith('.js'))).toBe(true);
  expect(artifacts.filter(file => /\.map$/i.test(file.name)).map(file => file.name)).toEqual([]);
  for (const file of artifacts.filter(file => /\.(?:js|css|html)$/i.test(file.name))) {
    const content = await readFile(join(file.parentPath, file.name), 'utf8');
    expect(content, file.name).not.toMatch(/(?:\/\/[#@]\s*sourceMappingURL\s*=|\/\*[#@]\s*sourceMappingURL\s*=)/);
  }
});
