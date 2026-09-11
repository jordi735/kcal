import { expect, type Page, type Response } from '@playwright/test';

export const CORE_READS = new Set(['/entries', '/entries/week', '/settings']);

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

export async function frame(page: Page) {
  await page.evaluate(() => new Promise<void>((done) => {
    requestAnimationFrame(() => requestAnimationFrame(() => done()));
  }));
}

// Synthetic events exercise application lifecycle handlers without destroying
// the JS heap. Actual installed-PWA suspension still needs device QA.
export async function background(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('blur'));
  });
}

export async function foreground(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
}

export async function resume(page: Page) {
  await background(page);
  await foreground(page);
}

// Drain core reads and response bodies before side-channel edits or counting
// requests. Waiting only for the Home shell leaves boot reads in flight.
export async function readCycle(page: Page, action: () => Promise<unknown>, expected = 5) {
  const responses: Response[] = [];
  const record = (response: Response) => {
    if (response.request().method() === 'GET' && CORE_READS.has(new URL(response.url()).pathname)) {
      responses.push(response);
    }
  };
  page.on('response', record);
  try {
    await action();
    await expect.poll(() => responses.length).toBe(expected);
    await Promise.all(responses.map((response) => response.finished()));
    await frame(page);
    expect(responses).toHaveLength(expected);
    return responses;
  } finally {
    page.off('response', record);
  }
}
