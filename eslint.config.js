// @ts-check
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Everything the deterministic simulation core must never touch. */
const CORE_FORBIDDEN_IMPORTS = [
  { group: ['three', 'three/*'], message: 'src/core est pur : aucun import de three.' },
  { group: ['react', 'react-dom', 'react/*'], message: 'src/core est pur : aucun import de React.' },
  { group: ['@react-three/*', 'postprocessing', 'howler', 'zustand', 'zustand/*'], message: 'src/core est pur : pas de rendu, audio ni état UI.' },
  { group: ['@render/*', '@ui/*', '@state/*', '@audio/*', '**/render/**', '**/ui/**', '**/state/**', '**/audio/**'], message: 'src/core ne dépend jamais des couches supérieures.' },
];

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules', 'assets-src', 'public', 'playwright-report', 'test-results', '.claude'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2023, globals: { ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['src/**/*.tsx', 'src/render/**/*.ts', 'src/ui/**/*.ts', 'src/state/**/*.ts'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['src/core/**/*.ts'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-imports': ['error', { patterns: CORE_FORBIDDEN_IMPORTS }],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Utiliser le Rng à graine passé en paramètre (src/core/rng.ts).' },
        { object: 'Date', property: 'now', message: 'Le core ne lit pas l\'horloge : le temps est un paramètre.' },
        { object: 'performance', property: 'now', message: 'Le core ne lit pas l\'horloge : le temps est un paramètre.' },
      ],
      'no-restricted-globals': ['error', 'window', 'document', 'navigator', 'localStorage', 'requestAnimationFrame'],
      'no-console': 'error',
    },
  },
  {
    files: ['scripts/**/*.ts', 'tests/**/*.ts', '*.config.ts', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off' },
  },
);
