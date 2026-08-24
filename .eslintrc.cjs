/**
 * Lint configuration.
 *
 * One root config for the whole workspace, with overrides per package rather
 * than a config file in each. The packages share a TypeScript baseline and
 * differ only in environment (Node for the API, browser for the web client), so
 * three near-identical files would drift.
 *
 * Type-aware rules are deliberately NOT enabled. `parserOptions.project` makes
 * every lint run a full type-check of three packages, which roughly triples CI
 * time to duplicate what `npm run typecheck` already does. The rules kept here
 * are the ones a type-check cannot catch.
 */

module.exports = {
  root: true,
  env: { es2022: true, node: true },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    // Last, so it can switch off everything stylistic that Prettier owns.
    'prettier',
  ],
  settings: {
    'import/resolver': {
      typescript: { alwaysTryTypes: true },
    },
  },
  rules: {
    // A leading underscore is the established opt-out for a deliberately unused
    // binding — a caught error nobody inspects, or a positional parameter.
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      },
    ],

    // `any` is a warning rather than an error: it appears in a handful of
    // library boundaries where the alternative is a worse cast, and failing the
    // build for it would push people toward `@ts-expect-error` instead.
    '@typescript-eslint/no-explicit-any': 'warn',

    // Interfaces with no members are usually a mistake, but extending one to
    // add a nominal name is a legitimate pattern in the DTO layer.
    '@typescript-eslint/no-empty-interface': ['error', { allowSingleExtends: true }],

    'no-console': ['warn', { allow: ['warn', 'error'] }],
    eqeqeq: ['error', 'always', { null: 'ignore' }],
    'no-var': 'error',
    'prefer-const': 'error',
    'object-shorthand': ['error', 'properties'],
  },
  overrides: [
    // --- Web client --------------------------------------------------------
    {
      files: ['apps/web/**/*.{ts,tsx}'],
      env: { browser: true, node: false },
      plugins: ['react-hooks', 'react-refresh'],
      extends: ['plugin:react-hooks/recommended'],
      rules: {
        // A dependency array that lies is the single most common source of
        // stale-data bugs in this app, so it is an error rather than a warning.
        'react-hooks/exhaustive-deps': 'error',

        // Fast Refresh can only preserve state when a module exports components
        // and nothing else. Constants are allowed because the palette maps live
        // beside the component that defines them.
        'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      },
    },

    // --- API ---------------------------------------------------------------
    {
      files: ['apps/api/**/*.ts'],
      env: { node: true },
      rules: {
        // Nest builds services out of decorated classes with injected fields;
        // the constructor-parameter-property idiom trips this rule constantly.
        '@typescript-eslint/no-extraneous-class': 'off',
      },
    },

    // --- Barrels and context modules ---------------------------------------
    // `only-export-components` protects React Fast Refresh, which can only
    // preserve state when a module exports components alone. These three
    // deliberately export hooks and providers alongside components — that is
    // what a barrel and a context module are — so the rule has nothing useful
    // to say about them. Editing one already triggers a full reload, and
    // splitting them apart to satisfy a dev-only heuristic would trade a real
    // API for an imaginary one.
    {
      files: [
        'apps/web/src/components/ui/index.tsx',
        'apps/web/src/components/domain/index.tsx',
        'apps/web/src/lib/auth.tsx',
      ],
      rules: { 'react-refresh/only-export-components': 'off' },
    },

    // --- Tests -------------------------------------------------------------
    {
      files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        'no-console': 'off',
      },
    },

    // --- Config and scripts ------------------------------------------------
    {
      files: ['**/*.cjs', '**/*.config.ts', '**/scripts/**', 'apps/api/prisma/seed.ts'],
      rules: {
        'no-console': 'off',
        '@typescript-eslint/no-var-requires': 'off',
      },
    },
  ],
};
