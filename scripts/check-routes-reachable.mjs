#!/usr/bin/env node
/**
 * Every route the server offers is one the interface can actually reach.
 *
 * Written after an audit found two features that were built, tested, recorded
 * as done — and reachable only with curl. An administrator could not switch on
 * the second-factor requirement, and could not lift somebody's second factor,
 * which is the *only* way back for a person who has lost both their phone and
 * their recovery codes.
 *
 * The measurement had to be built twice, and the first two attempts are the
 * reason this file explains itself at length:
 *
 * 1. Matching each path *segment* somewhere in the web code found nothing
 *    missing. Of course it did: "users", "second-factor" and "remove" all
 *    appear, in unrelated places.
 * 2. Matching the literal prefix found six routes but not the real gap, because
 *    `/api/admin/users` appears — as the users list — and the check stopped
 *    there.
 * 3. Requiring the suffix as well still passed it, because
 *    `/second-factor/remove` appears too: it is the *self*-removal route.
 *
 * A substring cannot answer this question while two routes share an ending. So
 * this compares whole URL **shapes**: every `/api/...` string the web builds,
 * with `${...}` collapsed to a parameter, against every route the server
 * registers with `:params` collapsed the same way. A shape either appears or it
 * does not.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const read = (dir, suffixes, into = []) => {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) read(path, suffixes, into);
    else if (suffixes.some((one) => entry.endsWith(one))) into.push(readFileSync(path, 'utf8'));
  }
  return into;
};

const web = read('packages/web/src', ['.ts', '.tsx']).join('\n');
const server = read('packages/server/src', ['.ts']).join('\n');

const shape = (url) => url.replace(/\$\{[^}]*\}/g, ':x').replace(/:[A-Za-z]+/g, ':x').split('?')[0].replace(/\/$/, '');

const built = new Set();
for (const match of web.matchAll(/[`'"](\/api\/[^`'"]*)[`'"]/g)) built.add(shape(match[1]));

const routes = [
  ...new Set([...server.matchAll(/router\.(?:get|post|put|patch|delete)\('(\/api\/[^']+)'/g)].map((m) => m[1])),
].sort();

/**
 * Routes no interface should build, each with the reason.
 *
 * Named individually rather than matched by pattern, so adding one is a
 * decision somebody makes and not a rule that quietly widens.
 */
const NOT_FOR_THE_INTERFACE = new Map([
  ['/api/health', 'for a load balancer'],
  ['/api/ready', 'for a load balancer'],
  ['/api/me', 'for scripts and for people poking at the API'],
  ['/api/auth/oidc/callback', 'the browser is sent here by the provider'],
  ['/api/auth/sessions', 'listing your own sessions is not built yet'],
  ['/api/auth/sessions/:x', 'nor is revoking one'],
  ['/api/favourites/reorder', 'the sidebar reorders by drag, through another route'],
  ['/api/collections/:x', 'reached through the view routes'],
  ['/api/groups/:x', 'reached through the workspace routes'],
  ['/api/inbox', 'built with a query string the shape reader cannot see'],
  ['/api/pages/:x/export', 'a download, opened as a link rather than fetched'],
  ['/api/pages/:x/import', 'sent by the import dialog with a built URL'],
  ['/api/pages/:x/move-to-workspace', 'sent by the move dialog with a built URL'],
  ['/api/workspaces/:x/comments', 'read through the sync connection'],
  ['/api/workspaces/:x/export', 'a download, opened as a link'],
  [
    '/api/instance/logo',
    // The interface never writes this path: it draws whatever `/api/instance`
    // gives it as the logo's address, and that address carries a cache-busting
    // parameter derived from the storage key. A client building the URL itself
    // would be a client showing last month's mark out of a proxy (ADR-0123).
    'an <img src> the server hands out, with the key in the address',
  ],
]);

const unreachable = routes.filter((route) => {
  const key = shape(route);
  return !built.has(key) && !NOT_FOR_THE_INTERFACE.has(key);
});

if (routes.length < 80) {
  console.error(`[check] only found ${routes.length} routes — the reader is broken`);
  process.exit(1);
}

if (unreachable.length > 0) {
  console.error('[check] routes the interface cannot reach:');
  for (const route of unreachable) console.error(`  ${route}`);
  console.error(
    '\nA feature reachable only with curl is not a feature. Add the control, or\n' +
      'name the route in NOT_FOR_THE_INTERFACE with the reason.',
  );
  process.exit(1);
}

console.log(
  `[check] ${routes.length} routes, ${NOT_FOR_THE_INTERFACE.size} deliberately not in the interface — ok`,
);
