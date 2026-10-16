import { expect, test, type Page } from '@playwright/test';

/**
 * The soundtrack (ADR-051): nothing plays before the player's first input; then the menus play
 * « Kalenda maya » and the chronicle « Reis glorios », one air at a time. Heard through the files
 * the browser fetches and what Howler says it plays.
 */

const IGNORED = [/THREE\.Clock/, /toNonIndexed/, /glGetProgramiv/];
const CAMPAIGN_KEY = 'siege.campaign.v1';
/** A screen's code, then its air, load at their first visit (the dev server compiles the former then). */
const SCREEN_TIMEOUT_MS = 30_000;
const MUSIC_TIMEOUT_MS = 15_000;

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !IGNORED.some((re) => re.test(msg.text()))) errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

/** The music files Howler plays now. */
const playing = (page: Page) =>
  page.evaluate(() => {
    const howler = (window as unknown as { Howler?: { _howls: { _src: string; playing(): boolean }[] } }).Howler;
    return (howler?._howls ?? []).filter((h) => h.playing() && /music_/.test(String(h._src))).map((h) => /music_[a-z]+/.exec(String(h._src))?.[0]);
  });

test('the menus play Kalenda maya after the first input, the chronicle Reis glorios', async ({ page }) => {
  const errors = trackErrors(page);
  const fetched: string[] = [];
  page.on('request', (r) => {
    const m = /\/(music_\w+?)_\d+\.ogg/.exec(r.url());
    if (m?.[1]) fetched.push(m[1]);
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Siège' })).toBeVisible({ timeout: SCREEN_TIMEOUT_MS });
  expect(fetched).toEqual([]);

  await page.mouse.click(10, 10);
  await expect.poll(() => playing(page), { timeout: MUSIC_TIMEOUT_MS }).toEqual(['music_map']);
  expect(fetched).toContain('music_map');

  await page.evaluate(([key]) => window.localStorage.setItem(key!, JSON.stringify({ version: 3, conquered: { 'roche-grise': { banners: { taken: true, swift: true, spared: true, feat: true }, stratagem: null, turns: 9 } } })), [CAMPAIGN_KEY]);
  await page.goto('/chronique');
  await page.locator('.chronicle').waitFor({ timeout: SCREEN_TIMEOUT_MS });
  await page.mouse.click(5, 5);
  await expect.poll(() => playing(page), { timeout: MUSIC_TIMEOUT_MS }).toEqual(['music_chronicle']);
  expect(errors).toEqual([]);
});

test('?nosound keeps every screen silent', async ({ page }) => {
  const fetched: string[] = [];
  page.on('request', (r) => {
    if (/\/music_\w+\.ogg/.test(r.url())) fetched.push(r.url());
  });
  await page.goto('/?nosound');
  await expect(page.getByRole('heading', { name: 'Siège' })).toBeVisible({ timeout: SCREEN_TIMEOUT_MS });
  await page.mouse.click(10, 10);
  await page.waitForTimeout(1500);
  expect(fetched).toEqual([]);
});
