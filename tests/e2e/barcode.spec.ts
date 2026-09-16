import { expect, test, type Page } from '@playwright/test';
import { signInFresh } from './helpers';

test.use({ storageState: { cookies: [], origins: [] } });

type CameraFixture = {
  pattern: string | null;
  requests: number;
  tracks: MediaStreamTrack[];
};

declare global {
  interface Window {
    __barcodeCamera: CameraFixture;
  }
}

// Independent EAN-13 symbol encoding, including parity and guards. Prefixing a
// UPC-A number with zero produces its identical bars, allowing us to check that
// the real decoder returns the original 12-digit UPC instead of adding a zero.
function ean13Pattern(code: string): string {
  if (!/^\d{13}$/.test(code)) throw new Error('EAN fixture must contain 13 digits');
  const digits = [...code].map(Number);
  const checksum = digits.reduce((sum, digit, index) => sum + digit * (index % 2 === 0 ? 1 : 3), 0);
  if (checksum % 10 !== 0) throw new Error('EAN fixture has an invalid checksum');
  const odd = ['0001101', '0011001', '0010011', '0111101', '0100011',
    '0110001', '0101111', '0111011', '0110111', '0001011'];
  const even = ['0100111', '0110011', '0011011', '0100001', '0011101',
    '0111001', '0000101', '0010001', '0001001', '0010111'];
  const parity = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
    'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'][digits[0]!];
  const left = digits.slice(1, 7).map((digit, index) =>
    (parity![index] === 'L' ? odd : even)[digit]).join('');
  const right = digits.slice(7).map((digit) =>
    [...odd[digit]!].map((bit) => bit === '0' ? '1' : '0').join('')).join('');
  return `101${left}01010${right}101`;
}

async function installCamera(page: Page, errorName: 'NotAllowedError' | 'NotFoundError' | null = null) {
  await page.addInitScript(({ errorName }) => {
    const camera: CameraFixture = { pattern: null, requests: 0, tracks: [] };
    window.__barcodeCamera = camera;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => {
        camera.requests++;
        if (errorName !== null) throw new DOMException('Camera fixture error', errorName);

        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 400;
        const context = canvas.getContext('2d');
        if (context === null) throw new Error('Camera fixture needs a canvas context');
        const draw = () => {
          context.fillStyle = 'white';
          context.fillRect(0, 0, canvas.width, canvas.height);
          const pattern = camera.pattern;
          if (pattern !== null) {
            context.fillStyle = 'black';
            const start = Math.floor((canvas.width - pattern.length * 5) / 2);
            for (let index = 0; index < pattern.length; index++) {
              if (pattern[index] === '1') context.fillRect(start + index * 5, 70, 5, 260);
            }
          }
        };
        draw();
        // These are native browser tracks and real video frames. Only camera
        // acquisition is replaced; the application and ZXing decode normally.
        const stream = canvas.captureStream(30);
        const tracks = stream.getVideoTracks();
        camera.tracks.push(...tracks);
        const paint = () => {
          if (tracks.every((track) => track.readyState === 'ended')) return;
          draw();
          requestAnimationFrame(paint);
        };
        requestAnimationFrame(paint);
        return stream;
      },
    });
  }, { errorName });
}

async function openScanner(page: Page) {
  await page.locator('.sheet').getByRole('button', { name: 'Scan barcode', exact: true }).tap();
  await expect(page.getByText('SCAN BARCODE', { exact: true })).toBeVisible();
}

async function trackStates(page: Page) {
  return page.evaluate(() => window.__barcodeCamera.tracks.map((track) => track.readyState));
}

async function showBarcode(page: Page, code: string) {
  await page.evaluate((pattern) => { window.__barcodeCamera.pattern = pattern; }, ean13Pattern(code));
}

async function settleScanIntervals(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    // Hold the result open across two default 500ms scan intervals. This is a
    // negative assertion: a second scan must not trigger another lookup.
    const until = performance.now() + 1100;
    const frame = () => {
      if (performance.now() >= until) resolve();
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }));
}

for (const [id, format, barcode] of [
  ['J-256', 'EAN-13', '5901234123457'],
  ['J-257', 'UPC-A', '036000291452'],
] as const) {
  test(`[${id}] ${format} video decoding delivers one exact result and releases the camera`, async ({ page, request }) => {
    await installCamera(page);
    await signInFresh(page, request, `barcode-${format}`);
    const lookups: string[] = [];
    let releaseResponse = () => {};
    const responseReady = new Promise<void>((resolve) => { releaseResponse = resolve; });
    await page.route('**/products/barcode/*', async (route) => {
      lookups.push(decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1)!));
      // Keep the scanner mounted after detection to expose repeated callbacks.
      await responseReady;
      await route.fulfill({ status: 404, json: { error: 'not_found' } });
    });

    try {
      await page.getByRole('button', { name: 'ADD FOOD', exact: true }).tap();
      await openScanner(page);
      await expect.poll(() => trackStates(page)).toEqual(['live']);
      await showBarcode(page, barcode.length === 12 ? `0${barcode}` : barcode);
      await expect.poll(() => lookups).toEqual([barcode]);
      await expect.poll(() => trackStates(page)).toEqual(['ended']);
      await expect(page.getByText('SCAN BARCODE', { exact: true })).toBeVisible();
      await settleScanIntervals(page);
      expect(lookups).toEqual([barcode]);

      releaseResponse();
      const sheet = page.locator('.sheet');
      await expect(sheet.getByText('New Product', { exact: true })).toBeVisible();
      await expect(sheet.locator('label').filter({ hasText: /^Barcode$/ }).locator('..')
        .getByRole('textbox')).toHaveValue(barcode);
      await expect(page.getByText('SCAN BARCODE', { exact: true })).toHaveCount(0);
      expect(await trackStates(page)).toEqual(['ended']);
    } finally {
      releaseResponse();
    }
  });
}

test('[J-258] cancelling a live barcode camera releases its track and reopening scans with a new stream', async ({ page, request }) => {
  await installCamera(page);
  await signInFresh(page, request, 'barcode-reopen');
  await page.getByRole('button', { name: 'ADD FOOD', exact: true }).tap();
  await page.locator('.sheet').getByRole('button', { name: 'Add New', exact: true }).tap();
  await page.getByPlaceholder('e.g. Peanut Butter').fill('E2E Camera Reopen Draft');
  await openScanner(page);
  await expect.poll(() => trackStates(page)).toEqual(['live']);
  await page.getByRole('button', { name: '×', exact: true }).tap();
  await expect(page.getByText('SCAN BARCODE', { exact: true })).toHaveCount(0);
  await expect.poll(() => trackStates(page)).toEqual(['ended']);
  await expect(page.getByPlaceholder('e.g. Peanut Butter')).toHaveValue('E2E Camera Reopen Draft');

  await openScanner(page);
  await expect.poll(() => trackStates(page)).toEqual(['ended', 'live']);
  expect(await page.evaluate(() => window.__barcodeCamera.requests)).toBe(2);
  await showBarcode(page, '5901234123457');
  await expect(page.getByText('SCAN BARCODE', { exact: true })).toHaveCount(0);
  await expect(page.locator('.sheet').locator('label').filter({ hasText: /^Barcode$/ }).locator('..')
    .getByRole('textbox')).toHaveValue('5901234123457');
  await expect(page.getByPlaceholder('e.g. Peanut Butter')).toHaveValue('E2E Camera Reopen Draft');
  await expect.poll(() => trackStates(page)).toEqual(['ended', 'ended']);
});

for (const [id, errorName, message] of [
  ['J-259', 'NotAllowedError', 'Camera access denied.'],
  ['J-260', 'NotFoundError', 'No camera available.'],
] as const) {
  test(`[${id}] barcode scanning handles ${errorName} and returns to Add Food`, async ({ page, request }) => {
    await installCamera(page, errorName);
    await signInFresh(page, request, `barcode-${errorName}`);
    await page.getByRole('button', { name: 'ADD FOOD', exact: true }).tap();
    await openScanner(page);
    await expect(page.getByText('Scanner unavailable', { exact: true })).toBeVisible();
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    expect(await trackStates(page)).toEqual([]);
    expect(await page.evaluate(() => window.__barcodeCamera.requests)).toBe(1);
    await page.getByRole('button', { name: 'Close', exact: true }).tap();
    await expect(page.getByText('SCAN BARCODE', { exact: true })).toHaveCount(0);
    await expect(page.locator('.sheet').getByText('Add Food', { exact: true })).toBeVisible();
  });
}
