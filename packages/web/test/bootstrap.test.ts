/**
 * Bootstrap error handling.
 *
 * Tests the inline script in index.html, which is the only thing standing
 * between a broken bundle and a white page. React's error boundary cannot help
 * here: a module that fails to evaluate, a chunk that 404s, or a syntax error
 * means React never mounts at all.
 *
 * This exists because a white page happened twice, and the second time cost a
 * deployment cycle to work out that the browser was holding a cached bundle. A
 * white page is the worst failure mode available — indistinguishable from a
 * network problem, a bad deploy, or lost data.
 *
 * Runs against the *built* index.html, so it also fails if the script is ever
 * dropped or mangled by the build.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

import { JSDOM } from 'jsdom';

const here = path.dirname(fileURLToPath(import.meta.url));
const builtHtml = path.resolve(here, '../dist/index.html');

// The build output is not present on a fresh checkout until `pnpm build` runs.
// Skipping is better than failing: this asserts something about the build, and
// `pnpm test` should not require one.
const hasBuild = existsSync(builtHtml);

describe(
  'bootstrap error handling',
  { skip: hasBuild ? false : 'dist/index.html not built' },
  () => {
    const html = hasBuild ? readFileSync(builtHtml, 'utf8') : '';

    /** A document with the inline script running, as a browser would. */
    async function boot(): Promise<JSDOM> {
      const dom = new JSDOM(html, {
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        url: 'http://localhost/',
      });
      // Let the inline script register its listeners.
      await new Promise((resolve) => setTimeout(resolve, 30));
      return dom;
    }

    const settle = (): Promise<void> =>
      new Promise((resolve) => setTimeout(resolve, 30));

    test('the handler survives the build', () => {
      // A minified or stripped inline script would leave nothing to catch
      // anything, and the failure would only show as a white page in
      // production.
      assert.match(html, /SONE failed to start/);
      assert.match(html, /unhandledrejection/);
    });

    test('a script that fails to load produces a message', async () => {
      const dom = await boot();
      try {
        const script = dom.window.document.querySelector('script[type=module]');
        assert.ok(script, 'the built HTML must load a module script');

        const event = new dom.window.Event('error');
        Object.defineProperty(event, 'target', { value: script });
        dom.window.dispatchEvent(event);
        await settle();

        const root = dom.window.document.getElementById('root')!;
        assert.ok(root.childElementCount > 0, 'something must be rendered');
        assert.match(root.querySelector('h2')?.textContent ?? '', /failed to start/);
        // The failing URL is named, because "it did not load" without saying
        // what did not load is not actionable.
        const detail = root.querySelector('pre')?.textContent ?? '';
        assert.match(detail, /assets\/|Failed to load/);
      } finally {
        dom.window.close();
      }
    });

    test('an exception during module evaluation produces a message', async () => {
      // This is the shape of the crash that took every page down: a throw
      // before React could mount.
      const dom = await boot();
      try {
        const event = new dom.window.Event('error');
        Object.defineProperty(event, 'error', {
          value: new Error('Cannot access before initialization'),
        });
        dom.window.dispatchEvent(event);
        await settle();

        const root = dom.window.document.getElementById('root')!;
        const detail = root.querySelector('pre')?.textContent ?? '';
        assert.match(detail, /Cannot access before initialization/);
        assert.ok(root.querySelector('button'), 'a reload button must be offered');
      } finally {
        dom.window.close();
      }
    });

    test('a rejected promise produces a message', async () => {
      const dom = await boot();
      try {
        const event = new dom.window.Event('unhandledrejection');
        Object.defineProperty(event, 'reason', { value: new Error('network down') });
        dom.window.dispatchEvent(event);
        await settle();

        const detail =
          dom.window.document.getElementById('root')?.querySelector('pre')?.textContent ?? '';
        assert.match(detail, /network down/);
      } finally {
        dom.window.close();
      }
    });

    test('only the first error is shown', async () => {
      // A cascade of follow-on errors must not replace the first, which is the
      // one that explains the failure.
      const dom = await boot();
      try {
        for (const message of ['the real cause', 'a follow-on error']) {
          const event = new dom.window.Event('error');
          Object.defineProperty(event, 'error', { value: new Error(message) });
          dom.window.dispatchEvent(event);
        }
        await settle();

        const detail =
          dom.window.document.getElementById('root')?.querySelector('pre')?.textContent ?? '';
        assert.match(detail, /the real cause/);
        assert.doesNotMatch(detail, /follow-on/);
      } finally {
        dom.window.close();
      }
    });

    test('the message does not claim data was lost', async () => {
      // Someone seeing this has no way to tell a render failure from data loss,
      // and assuming the worst is the natural reading. Saying so plainly is the
      // difference between an annoyance and a scare.
      const dom = await boot();
      try {
        const event = new dom.window.Event('error');
        Object.defineProperty(event, 'error', { value: new Error('x') });
        dom.window.dispatchEvent(event);
        await settle();

        const text = dom.window.document.getElementById('root')?.textContent ?? '';
        assert.match(text, /stored on the server|not affected/);
      } finally {
        dom.window.close();
      }
    });
  },
);
