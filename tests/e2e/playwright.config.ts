import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const PORT = 5199;

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
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    // Vite must serve the project root, not this config's folder.
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    port: PORT,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
