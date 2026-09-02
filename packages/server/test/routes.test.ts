/**
 * Every route module the server has is mounted.
 *
 * Written because a route in a new module has twice been invisible to a test
 * that builds its own router — the export route answered 404 until the API
 * suite registered it, and the import route needed the same. That is a test
 * problem rather than a server one, but the mirror of it is a real hazard: a
 * module written, exported and never registered in `main.ts` is a feature that
 * exists in the source and not in the running server.
 *
 * Counted rather than listed: a list of eighteen names would go stale, and this
 * test would then pass by not looking at the nineteenth.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

const sourcesIn = (dir: URL): Array<[string, string]> => {
  const out: Array<[string, string]> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
    if (entry.isDirectory()) out.push(...sourcesIn(child));
    else if (entry.name.endsWith('.ts')) out.push([entry.name, readFileSync(child, 'utf8')]);
  }
  return out;
};

test('every register…Routes function is called in main.ts', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

  const registrars = new Set<string>();
  for (const [, source] of sourcesIn(new URL('../src/', import.meta.url))) {
    for (const match of source.matchAll(/export function (register\w*Routes)\b/g)) {
      registrars.add(match[1] ?? '');
    }
  }

  assert.ok(registrars.size > 10, 'the route modules were found');
  const unmounted = [...registrars].filter((name) => !main.includes(`${name}(`));
  assert.deepEqual(unmounted, [], 'route modules never registered in main.ts');
});
