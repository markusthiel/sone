/**
 * Appearance preferences.
 *
 * The stored value is a contract with every browser that has already saved one,
 * so reading it has to survive partial, unknown and corrupt input rather than
 * throwing and taking the app down with it.
 */

import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { JSDOM } from 'jsdom';

let applyAppearance: typeof import('../src/hooks/useAppearance.ts').applyAppearance;
let TEXT_SCALES: typeof import('../src/hooks/useAppearance.ts').TEXT_SCALES;
let SCALE_LABELS: typeof import('../src/hooks/useAppearance.ts').SCALE_LABELS;
let dom: JSDOM;

describe('appearance', () => {
  before(async () => {
    // The url matters: on an opaque origin — which is what jsdom uses without
    // one — touching localStorage throws a SecurityError, and the failure
    // surfaces only as "failed running before hook".
    dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'http://localhost/',
    });
    for (const key of ['window', 'document', 'localStorage'] as const) {
      Object.defineProperty(globalThis, key, {
        value: (dom.window as unknown as Record<string, unknown>)[key],
        configurable: true,
        writable: true,
      });
    }
    const module = await import('../src/hooks/useAppearance.ts');
    applyAppearance = module.applyAppearance;
    TEXT_SCALES = module.TEXT_SCALES;
    SCALE_LABELS = module.SCALE_LABELS;
  });

  test('applying sets attributes the stylesheet keys on', () => {
    applyAppearance({ theme: 'dark', uiScale: 'large', editorScale: 'small' });
    const root = dom.window.document.documentElement;
    assert.equal(root.dataset['theme'], 'dark');
    assert.equal(root.dataset['uiScale'], 'large');
    assert.equal(root.dataset['editorScale'], 'small');
  });

  test('color-scheme is set, not only the CSS variables', () => {
    // Form controls, scrollbars and the browser's own rendering follow
    // color-scheme and cannot be reached by custom properties.
    applyAppearance({ theme: 'dark', uiScale: 'default', editorScale: 'default' });
    assert.equal(dom.window.document.documentElement.style.colorScheme, 'dark');

    applyAppearance({ theme: 'system', uiScale: 'default', editorScale: 'default' });
    assert.equal(dom.window.document.documentElement.style.colorScheme, 'light dark');
  });

  test('every scale has a label', () => {
    // A scale without one renders as an empty option, which is unusable and
    // easy to miss when adding a step.
    for (const scale of TEXT_SCALES) {
      assert.ok(SCALE_LABELS[scale], `${scale} has no label`);
    }
  });

  test('the scales are named, not numeric', () => {
    // A stored 1.125 says nothing about intent, and changing the underlying
    // step would silently change what everyone had chosen.
    for (const scale of TEXT_SCALES) {
      assert.equal(typeof scale, 'string');
      assert.ok(Number.isNaN(Number(scale)), `${scale} looks like a number`);
    }
  });
});
