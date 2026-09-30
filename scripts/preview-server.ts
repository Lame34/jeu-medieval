/**
 * Production preview for measurement scripts (bench, traces): optionally builds, serves the bundle
 * with `vite preview` on :4188, points SIEGE_URL at it (read by browser.ts at call time), and
 * always stops the server afterwards.
 */
import { execSync, spawn, type ChildProcess } from 'node:child_process';

export const PREVIEW_PORT = 4188;
export const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;
const START_TIMEOUT_MS = 30_000;
const POLL_MS = 300;

async function answers(url: string): Promise<boolean> {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await answers(url)) return;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(`server ${url} did not start`);
}

function stop(preview: ChildProcess): void {
  // Tree first: killing the shell first orphans the vite preview it started (port left busy).
  if (process.platform === 'win32' && preview.pid) {
    try {
      execSync(`taskkill /pid ${preview.pid} /T /F`, { stdio: 'ignore' });
    } catch {
      /* already gone */
    }
  }
  preview.kill();
}

export async function withPreview<T>(options: { readonly build: boolean }, run: () => Promise<T>): Promise<T> {
  // A stale preview left on the port would be measured instead of this build (strictPort fails silently).
  if (await answers(PREVIEW_URL)) throw new Error(`${PREVIEW_URL} already answers: stop the stale preview server first`);
  if (options.build) execSync('npx vite build --logLevel warn', { stdio: 'inherit' });
  const preview: ChildProcess = spawn('npx', ['vite', 'preview', '--port', String(PREVIEW_PORT), '--strictPort'], { shell: true, stdio: 'ignore' });
  try {
    await waitForServer(PREVIEW_URL, START_TIMEOUT_MS);
    process.env['SIEGE_URL'] = PREVIEW_URL;
    return await run();
  } finally {
    stop(preview);
  }
}
