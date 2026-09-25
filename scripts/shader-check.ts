/**
 * Loads a scene headless and prints every WebGL / console error (shader compile logs included).
 * Usage: node scripts/shader-check.ts [/lookdev]
 */
import { launch, VIEWPORT, DEV_URL } from './browser.ts';

const path = process.argv[2] ?? '/lookdev';
const browser = await launch();
try {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const messages: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') messages.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => messages.push(`[pageerror] ${String(err)}`));
  await page.goto(`${DEV_URL}${path}?bench`);
  await page.waitForTimeout(15_000);
  const ready = await page.evaluate(() => document.body.dataset['sceneReady'] ?? 'no');
  console.log(`sceneReady=${ready} gpu=${await page.evaluate(() => window.__perf?.gpu ?? '?')}`);
  for (const m of messages) {
    const lines = m.split('\n');
    const errorLines = lines.filter((l) => /ERROR|Material Name|error|warning/i.test(l)).slice(0, 12);
    console.log(errorLines.join('\n') || lines.slice(0, 3).join('\n'));
    console.log('---');
  }
  if (messages.length === 0) console.log('no errors');
} finally {
  await browser.close();
}
