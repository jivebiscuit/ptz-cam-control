// Lint setup: `npm run lint`. Main-process files are Node (CommonJS); renderer.js is a plain browser script.
import js from '@eslint/js';
import globals from 'globals';

const shared = {
  'no-unused-vars': ['warn', { args: 'none' }],
  'no-shadow': 'warn',
  'prefer-const': 'warn',
  eqeqeq: ['warn', 'always', { null: 'ignore' }], // `x == null` (null or undefined) is intentional
};

export default [
  { ignores: ['node_modules/**', 'dist/**'] },
  js.configs.recommended,
  { files: ['src/*.js', 'scripts/*.js', 'eslint.config.mjs'], ignores: ['src/renderer.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } }, rules: shared },
  { files: ['eslint.config.mjs'], languageOptions: { sourceType: 'module' } },
  { files: ['src/renderer.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser } }, rules: shared },
];
