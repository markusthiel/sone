/**
 * Every path the client asks for is a route the server registers.
 *
 * Written because I have invented two: `/api/rows/:id/values/:fieldId`, which is
 * `/api/pages/:rowId/properties/:fieldId`, and `/api/workspaces/:id/collections`,
 * which does not exist at all. The first one cost more than a compile error —
 * the test that expected a *refusal* passed, because both calls 404'd and one of
 * them was supposed to.
 *
 * A 404 from a wrong path is indistinguishable from a 404 that means what it
 * says, which is why this has to be checked by reading rather than by running.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

function sources(dir: URL): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
    if (entry.isDirectory()) out.push(...sources(child));
    else if (entry.name.endsWith('.ts')) out.push(readFileSync(child, 'utf8'));
  }
  return out;
}

/**
 * A template path, with its interpolations flattened.
 *
 * An interpolation that could produce a query string ends the path: several
 * calls build `?dryRun=true` inside the template, and substituting a placeholder
 * there would glue the query onto the last segment. My first version did exactly
 * that and reported three routes as missing that are all registered.
 */
function concretePath(path: string): string {
  const out: string[] = [];
  for (const part of path.split(/(\$\{[^}]*\})/)) {
    if (part.startsWith('${')) {
      if (part.includes('?')) break;
      out.push('X');
    } else {
      if (part.includes('?')) {
        out.push(part.split('?')[0] ?? '');
        break;
      }
      out.push(part);
    }
  }
  return out.join('').replace(/\/$/, '');
}

test('the client asks for no path the server does not serve', () => {
  const registered: RegExp[] = [];
  for (const source of sources(new URL('../../server/src/', import.meta.url))) {
    for (const match of source.matchAll(
      /router\.(?:get|post|put|patch|delete)\(\s*'([^']+)'/g,
    )) {
      const route = match[1] ?? '';
      registered.push(new RegExp(`^${route.replace(/:[A-Za-z]+/g, '[^/]+')}$`));
    }
  }
  assert.ok(registered.length > 100, 'the routes were found');

  const client = readFileSync(new URL('../src/api/client.ts', import.meta.url), 'utf8');
  const asked = [...client.matchAll(/`(\/api\/[^`]*)`/g)].map((match) => match[1] ?? '');
  assert.ok(asked.length > 40, 'the calls were found');

  const unserved = asked.filter(
    (path) => !registered.some((route) => route.test(concretePath(path))),
  );
  assert.deepEqual([...new Set(unserved)], [], 'client paths with no route');
});
