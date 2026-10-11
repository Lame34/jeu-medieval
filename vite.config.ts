import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const fromRoot = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export const aliases = {
  '@core': fromRoot('./src/core'),
  '@data': fromRoot('./src/data'),
  '@render': fromRoot('./src/render'),
  '@ui': fromRoot('./src/ui'),
  '@state': fromRoot('./src/state'),
  '@audio': fromRoot('./src/audio'),
};

/**
 * The deployed site's security headers (vercel.json, rule "/(.*)"), served by `vite preview` too:
 * a production build is tried locally under the same Content-Security-Policy before it is pushed.
 */
interface VercelConfig {
  readonly headers?: readonly { readonly source: string; readonly headers: readonly { readonly key: string; readonly value: string }[] }[];
}
const vercel = JSON.parse(readFileSync(fromRoot('./vercel.json'), 'utf8')) as VercelConfig;
const siteHeaders = Object.fromEntries((vercel.headers?.find((rule) => rule.source === '/(.*)')?.headers ?? []).map((h) => [h.key, h.value]));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: aliases },
  assetsInclude: ['**/*.glb', '**/*.ktx2'],
  worker: { format: 'es' },
  server: {
    port: 5188,
    strictPort: true,
    watch: { ignored: ['**/assets-src/**', '**/docs/captures/**', '**/perf-results/**'] },
  },
  preview: { port: 4188, strictPort: true, headers: siteHeaders },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 2048,
  },
});
