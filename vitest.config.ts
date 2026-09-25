import { defineConfig } from 'vitest/config';
import { aliases } from './vite.config.ts';

const CORE_COVERAGE_THRESHOLD = 80;

export default defineConfig({
  resolve: { alias: aliases },
  test: {
    environment: 'node',
    include: ['tests/core/**/*.test.ts'],
    reporters: ['dot'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts'],
      exclude: ['src/core/**/index.ts', 'src/core/**/types.ts'],
      reporter: ['text-summary', 'html'],
      thresholds: {
        lines: CORE_COVERAGE_THRESHOLD,
        branches: CORE_COVERAGE_THRESHOLD,
        functions: CORE_COVERAGE_THRESHOLD,
        statements: CORE_COVERAGE_THRESHOLD,
      },
    },
  },
});
