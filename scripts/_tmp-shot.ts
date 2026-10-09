import { launch, VIEWPORT } from './browser.ts';
const browser = await launch();
try {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await page.goto(`${process.env['SIEGE_URL'] ?? 'http://localhost:5188'}/battle?e2e&seed=siege-1&weather=clear&hour=11`);
  await page.waitForFunction(() => document.body.dataset['sceneReady'] === 'true', undefined, { timeout: 180_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: process.argv[2] as string });
} finally {
  await browser.close();
}
