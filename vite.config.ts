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
  preview: { port: 4188, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 2048,
  },
});
