// ESLint 9 flat config (checklist C0.3, arch §2).
// Scope is pragmatic for Increment 0: the prototype views are style-reference
// code (STATE.md D1) and are linted with the base JS ruleset only — they are
// not rewritten to satisfy stricter rules. New src/data/ TS modules and tests
// get the typescript-eslint recommended set.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import prettier from 'eslint-config-prettier';

export default [
  // The rig's assembled parts (dev-env/README.md) hold upstream and built JS: not ours to lint.
  {
    ignores: [
      'node_modules/',
      'dist/',
      'coverage/',
      'dev-env/app-resources/',
      'dev-env/resources-cache/',
      'dev-env/state/',
      'dev-env/upstream/',
    ],
  },

  // Prototype app + config files (JS/JSX)
  {
    files: ['**/*.{js,jsx}'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { react },
    rules: {
      ...js.configs.recommended.rules,
      // JSX usage counts as usage (otherwise every component import reads unused).
      'react/jsx-uses-vars': 'error',
      // The prototype imports React for JSX readability even under the
      // automatic runtime; don't force a rewrite (D1 style-reference code).
      'no-unused-vars': ['error', { varsIgnorePattern: '^React$', argsIgnorePattern: '^_' }],
    },
  },

  // i18n discipline (C1a.8, TEST-PLAN "no hardcoded EN literals in views"):
  // JSX text in the product views must come from the catalog via t(). Symbols,
  // separators, and numerals are layout, not language.
  {
    files: ['src/views/**/*.jsx', 'src/App.jsx'],
    plugins: { react },
    rules: {
      'react/jsx-no-literals': [
        'error',
        {
          noStrings: true,
          ignoreProps: true,
          // 'translationCore' + '4' compose the brand wordmark — a product
          // name, not UI language; it is never translated.
          allowedStrings: ['≡', '≣', '→', '←', '+', '·', '%', '✕', '▾', '▸', '⟷', '(', ')', '—', '🌱', '4', 'translationCore', '®', '“', '”', 'ℹ'],
        },
      ],
    },
  },

  // New data-layer modules + tests (TS)
  ...tseslint.configs.recommended.map((cfg) => ({
    ...cfg,
    files: ['src/data/**/*.ts', 'test/**/*.{ts,tsx}'],
  })),

  // Prettier last: disables stylistic rules that would fight the formatter.
  prettier,
];
