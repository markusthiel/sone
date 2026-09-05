#!/usr/bin/env node
/**
 * Every right in the enumeration is actually consulted somewhere.
 *
 * A role is a name for a set of rights (ADR-0087), and the set is edited in a
 * settings screen. A switch in that screen that gates nothing is worse than a
 * missing feature: somebody turns it off, believes they have taken something
 * away, and has not. Nothing in the type system can notice — a right is a
 * string in an array, and an array with one unused string typechecks.
 *
 * So the enumeration and the checks are held together here. The rule is: write
 * the check first, then add the name. If this fails, either a right was added
 * with nothing behind it, or a check was deleted and left a promise standing.
 *
 * Deliberately narrow, like `check-adr-references.mjs`: it looks for the
 * literal name in the server's source outside the file that declares it. That
 * cannot tell an enforcement from a mention in a comment, and it does not try
 * — a checker that needed to understand control flow would be a checker people
 * argue with, and one they argue with is one they turn off. What it does catch
 * is the failure that actually happens: a name nobody has wired up at all.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/*
 * The declaration can be pointed elsewhere, and only so that a test can show
 * this failing.
 *
 * A guard nobody has seen catch anything is a guard nobody should believe, and
 * the alternative ways to demonstrate it are worse: editing the real
 * enumeration from a test leaves the repository dirty when the test is killed,
 * and a test that reimplements the rule tests its own copy.
 */
const DECLARATION =
  process.argv[2] ?? path.join(root, 'packages', 'core', 'src', 'types', 'access.ts');

const declared = await readFile(DECLARATION, 'utf8');
const block = /export const RIGHTS = \[(.*?)\] as const;/s.exec(declared);
if (!block?.[1]) {
  console.error('[check] could not find the RIGHTS enumeration in core/src/types/access.ts');
  process.exit(1);
}
const rights = [...block[1].matchAll(/'([a-z.]+)'/g)].map((one) => one[1]);
if (rights.length === 0) {
  console.error('[check] the RIGHTS enumeration is empty');
  process.exit(1);
}

/** Every .ts file under the server, which is where a right can be enforced. */
async function sources(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const at = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sources(at)));
    else if (entry.name.endsWith('.ts')) out.push(at);
  }
  return out;
}

const serverFiles = await sources(path.join(root, 'packages', 'server', 'src'));

/*
 * The two files that define the vocabulary do not count as using it.
 *
 * `standing.ts` names every right when it seeds the system roles, and
 * `rights.ts` is the helper the checks are made of. If either counted, an
 * unused right would look enforced because it appears in the list of rights.
 */
const DEFINERS = new Set([
  path.join(root, 'packages', 'server', 'src', 'auth', 'standing.ts'),
  path.join(root, 'packages', 'server', 'src', 'auth', 'rights.ts'),
]);

const uses = new Map(rights.map((one) => [one, 0]));
for (const file of serverFiles) {
  if (DEFINERS.has(file)) continue;
  const text = await readFile(file, 'utf8');
  for (const right of rights) {
    if (text.includes(`'${right}'`)) uses.set(right, uses.get(right) + 1);
  }
}

const unenforced = rights.filter((one) => uses.get(one) === 0);
if (unenforced.length > 0) {
  console.error(
    `[check] ${unenforced.length} right(s) that nothing consults: ${unenforced.join(', ')}`,
  );
  console.error(
    '[check] a right nobody checks is a lie. Write the check, or remove the name (ADR-0087).',
  );
  process.exit(1);
}

console.log(`[check] ${rights.length} rights, each consulted somewhere — ok`);
