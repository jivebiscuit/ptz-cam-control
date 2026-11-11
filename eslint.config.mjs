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
  { files: ['src/*.js', 'scripts/*.js', 'test/**/*.js', 'eslint.config.mjs'], ignores: ['src/renderer.js', 'src/util.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } }, rules: shared },
  { files: ['eslint.config.mjs'], languageOptions: { sourceType: 'module' } },
  { files: ['src/util.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser, module: 'readonly' } }, rules: shared },
  { files: ['src/renderer.js'], // esc and pollOne come from util.js, loaded first by index.html
    languageOptions: { sourceType: 'script', globals: { ...globals.browser, esc: 'readonly', pollOne: 'readonly' } }, rules: shared },
];
