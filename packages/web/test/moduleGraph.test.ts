/**
 * Module evaluation.
 *
 * Imports every module in the app and fails if any throws while being
 * evaluated. That class of failure produces a white page with nothing on it:
 * React never mounts, so no error boundary exists to catch anything.
 *
 * It has bitten this project once already in the editor package, where the
 * ProseMirror schema is constructed at module scope — an invalid schema throws
 * on import rather than on use. `new Schema(...)`, `new PluginKey(...)`, a
 * top-level array built from other modules: all of it runs at import time, and
 * a circular import can leave one of them reading `undefined`.
 *
 * This does not render anything. It answers one question — does the import
 * graph evaluate — and that question was expensive to answer by deployment.
 */

import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { JSDOM } from 'jsdom';

/** Modules that run code at import time, in dependency order. */
const MODULES = [
  '../src/buildInfo.ts',
  '../src/routes/paths.ts',
  '../src/api/client.ts',
  '../src/components/ErrorBoundary.tsx',
  '../src/components/Auth.tsx',
  '../src/components/Sidebar.tsx',
  '../src/components/Settings.tsx',
  '../src/components/Search.tsx',
  '../src/components/SlashMenu.tsx',
  '../src/components/EditorSurface.tsx',
  '../src/components/PageView.tsx',
  '../src/hooks/useRoute.ts',
  '../src/hooks/useSession.ts',
  '../src/hooks/usePages.ts',
  '../src/hooks/useSoneClient.ts',
  '../src/App.tsx',
] as const;

const DOM_GLOBALS = [
  'window',
  'document',
  'Node',
  'Element',
  'HTMLElement',
  'DocumentFragment',
  'Range',
  'getComputedStyle',
  'MutationObserver',
  'DOMParser',
  'Event',
  'KeyboardEvent',
  'localStorage',
  'sessionStorage',
] as const;

describe('module graph', () => {
  before(() => {
    const dom = new JSDOM('<!doctype html><div id="root"></div>', {
      pretendToBeVisual: true,
      url: 'http://localhost/',
    });
    for (const key of DOM_GLOBALS) {
      // Some globals on the Node global object are getter-only, so assignment
      // is not an option.
      Object.defineProperty(globalThis, key, {
        value: (dom.window as unknown as Record<string, unknown>)[key],
        configurable: true,
        writable: true,
      });
    }
  });

  for (const specifier of MODULES) {
    test(`${specifier} evaluates`, async () => {
      // Reported per module rather than as one import of App.tsx, so a failure
      // names the file instead of the entry point.
      const module: unknown = await import(specifier).catch((error: unknown) => {
        assert.fail(
          `${specifier} threw while being evaluated, which would leave a white ` +
            `page with no error boundary to catch it:\n\n${String(error)}`,
        );
      });
      assert.ok(module, `${specifier} exported nothing`);
    });
  }

  test('the app exports a component', () => {
    // A default-vs-named export mistake also produces a blank page, and the
    // build does not catch it.
    void import('../src/App.tsx').then((module) => {
      assert.equal(typeof module.App, 'function');
    });
  });
});
