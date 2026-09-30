/**
 * Shared Playwright launcher for captures and benchmarks: new-headless Chromium on the real GPU
 * (ANGLE/D3D11), 1080p, DPR 1. The GPU string is checked by callers.
 */
import { chromium, type Browser, type Page } from '@playwright/test';

export const VIEWPORT = { width: 1920, height: 1080 } as const;
const DEFAULT_URL = 'http://localhost:5188';
/**
 * Server the scripts open: `SIEGE_URL` (the bench points it at its production preview) or the
 * dev server. Read at call time: a constant evaluated at import ran before the bench set the
 * variable, so every bench measured the dev server instead of the build (fixed 2026-09-30).
 */
export function baseUrl(): string {
  return process.env['SIEGE_URL'] ?? DEFAULT_URL;
}

export const GPU_ARGS = ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-zero-copy'];
/** Uncapped frame rate for benchmarks (measures headroom above 60 Hz). */
export const UNCAPPED_ARGS = ['--disable-gpu-vsync', '--disable-frame-rate-limit'];

export async function launch(options: { readonly uncapped?: boolean; readonly headed?: boolean } = {}): Promise<Browser> {
  return chromium.launch({
    channel: 'chromium',
    headless: !options.headed,
    args: [...GPU_ARGS, ...(options.uncapped ? UNCAPPED_ARGS : [])],
  });
}

export async function openScene(browser: Browser, path: string): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.goto(`${baseUrl()}${path}`);
  await page.waitForFunction(() => document.body.dataset['sceneReady'] === 'true' && window.__perf?.ready === true, undefined, { timeout: 120_000 });
  return { page, errors };
}

export async function gpuString(page: Page): Promise<string> {
  return page.evaluate(() => window.__perf?.gpu ?? 'unknown');
}

export function isIntelArc(gpu: string): boolean {
  return /intel/i.test(gpu) && !/swiftshader|nvidia/i.test(gpu);
}
