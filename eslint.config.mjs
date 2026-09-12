/**
 * SONE — lint.
 *
 * `pnpm lint` has been in package.json since the beginning and has never run:
 * eslint was never a dependency and there was no configuration, so the script
 * failed with "eslint: not found". A lint script that does not run is worse than
 * none, because it looks like something is checking.
 *
 * Deliberately narrow, and it will stay narrow. TypeScript already rejects the
 * whole class of mistake a type-aware linter would repeat, and there is no
 * formatter here — so a large rule set would mostly produce style opinions to
 * argue with, and a lint nobody agrees with is a lint nobody runs.
 *
 * What is here catches things `tsc` cannot see:
 *
 *   - the rules of hooks, which is exactly what took a table off the page: five
 *     hooks after an early return, correct on paper and broken when mounted;
 *   - unreachable code and duplicate keys, which are always mistakes;
 *   - `no-console` in application code, because a log left in a component ships
 *     to everybody who opens the page.
 *
 * Rules are added when something has actually gone wrong, not in advance.
 */

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    /*
     * Unused `eslint-disable` comments are not reported.
     *
     * Several of them name rules this configuration deliberately leaves off —
     * `no-explicit-any`, `exhaustive-deps` — so they read as unused here and are
     * doing their job in an editor running a stricter default. Deleting them to
     * quieten this file would remove information from the place it belongs, for
     * a rule set nobody has agreed to.
     */
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },
  {
    // Generated, vendored, or not ours to lint.
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.d.ts',
      'packages/editor/vendor/**',
      // Generators, not application code: plain CommonJS run by hand against
      // `docx` and `pptxgenjs`, which are not workspace dependencies.
      'tools/brand/**',
    ],
  },

  js.configs.recommended,

  {
    files: ['**/*.{ts,tsx,mts,mjs}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      // TypeScript's own job; the base rule reports every type as undefined.
      'no-undef': 'off',
      // Reported by tsc with better messages, and the base rule cannot see a
      // type-only import.
      'no-unused-vars': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  {
    files: ['packages/web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // The one that would have caught the table disappearing.
      'react-hooks/rules-of-hooks': 'error',
      // Not `exhaustive-deps`: several effects here deliberately key on less
      // than they read — the editor is rebuilt on the document and not on the
      // handle, which is recreated on every notification — and each of those is
      // explained where it stands. Turning them into suppression comments would
      // move the reasoning out of the code and into a directive.
      'react-hooks/exhaustive-deps': 'off',
      'no-console': ['error', { allow: ['error', 'warn'] }],
    },
  },

  {
    /*
     * The service worker runs somewhere else (ADR-0180).
     *
     * Not a window and not Node: its global is `self`, it has `clients` and a
     * `registration`, and it is plain JavaScript in `public/` rather than
     * something the build touches — a worker served from a hashed path would
     * control that path and nothing else.
     *
     * So the globals are declared rather than the rule turned off: `self` being
     * known is the point, and an undefined name in a file nobody compiles is
     * exactly the mistake worth keeping the rule for.
     */
    files: ['packages/web/public/*.js'],
    languageOptions: {
      globals: { self: 'readonly', fetch: 'readonly', Response: 'readonly' },
    },
  },

  {
    // Scripts and tests are run by a person watching the output.
    files: ['scripts/**', 'packages/*/test/**', 'packages/*/scripts/**'],
    rules: { 'no-console': 'off' },
  },
);
