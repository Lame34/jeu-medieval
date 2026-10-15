import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const PORT = 5199;
/** The load budget test (battle.spec.ts): timed alone, before the others. */
const LOAD_BUDGET = /within the load and worldgen budgets/;

/** E2E smoke tests: dev server started by Playwright, new-headless Chromium on the real GPU. */
export default defineConfig({
  testDir: '.',
  timeout: 120_000,
  reporter: [['line']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 720 },
    channel: 'chromium',
    launchOptions: { args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] },
  },
  // Seven browsers loading battles at once time the machine, not the game: the load budget is
  // measured first and alone, then the rest of the suite runs in parallel.
  projects: [
    { name: 'load-budget', grep: LOAD_BUDGET },
    { name: 'suite', grepInvert: LOAD_BUDGET, dependencies: ['load-budget'] },
  ],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    // Vite must serve the project root, not this config's folder.
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    port: PORT,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
