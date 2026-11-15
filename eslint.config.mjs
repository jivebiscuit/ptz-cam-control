// Lint setup: `npm run lint`. Main-process files are Node (CommonJS); the page's scripts are plain browser scripts.
import js from '@eslint/js';
import globals from 'globals';
import fs from 'node:fs';

const shared = {
  'no-unused-vars': ['warn', { args: 'none' }],
  'no-shadow': 'warn',
  'prefer-const': 'warn',
  eqeqeq: ['warn', 'always', { null: 'ignore' }], // `x == null` (null or undefined) is intentional
};

// The page is several classic scripts (listed in index.html, in load order) that share one global scope.
// So every top-level function/const/let in one of them counts as a global for the others.
const pageScripts = [...fs.readFileSync('src/index.html', 'utf8').matchAll(/<script src="([\w.]+)"/g)].map((m) => `src/${m[1]}`);
const pageGlobals = {};
// names declared by one top-level `const|let a = ..., b = ...;` line: the identifier that starts each top-level comma-separated part
function declaredNames(text) {
  const names = []; let depth = 0, start = 0, quote = '';
  const take = (part) => { const m = /^\s*([\w$]+)/.exec(part); if (m) names.push(m[1]); };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
    if (c === '\'' || c === '"' || c === '`') quote = c;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) { take(text.slice(start, i)); start = i + 1; }
    else if (c === ';' && depth === 0) break;
  }
  take(text.slice(start));
  return names;
}
for (const f of pageScripts) {
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) { // CRLF checkouts (Windows) too
    const fn = /^(?:async\s+)?function\s+([\w$]+)/.exec(line);
    if (fn) { pageGlobals[fn[1]] = 'writable'; continue; }
    const decl = /^(?:const|let)\s+(.*)$/.exec(line);
    if (decl) declaredNames(decl[1]).forEach((n) => { pageGlobals[n] = 'writable'; });
  }
}

export default [
  { ignores: ['node_modules/**', 'dist/**'] },
  js.configs.recommended,
  { files: ['src/*.js', 'scripts/*.js', 'test/**/*.js', 'eslint.config.mjs'], ignores: pageScripts,
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } }, rules: shared },
  { files: ['eslint.config.mjs'], languageOptions: { sourceType: 'module' } },
  { files: pageScripts, // vars: 'local' because most top-level names are used by the other scripts, not their own file
    languageOptions: { sourceType: 'script', globals: { ...globals.browser, ...pageGlobals, copyFlow: 'readonly', module: 'readonly' } },
    rules: { ...shared, 'no-unused-vars': ['warn', { args: 'none', vars: 'local' }], 'no-redeclare': 'off',
      'prefer-const': 'off', 'no-unassigned-vars': 'off' } } // shared top-level state (cfg, sel...) is assigned from other files,
];
