#!/usr/bin/env node
/**
 * Every variable the server reads is named where an operator can set it.
 *
 * Written because fourteen were not. Compose does not forward the host's
 * environment: a variable set in `.env` and not named in the service's
 * `environment:` block never reaches the container. So an operator who filled
 * in `SONE_SMTP_PASSWORD` — which `.env.example` invites — got a server that
 * never saw it, and mail that failed to authenticate for no visible reason.
 *
 * The same shape as the other checks in this repository: it reads the files
 * rather than running anything, and it starts by proving it can fail.
 *
 * ## It used to read one file (ADR-0112)
 *
 * `config.ts` is where most settings are parsed, and it is where the fourteen
 * were found — so that is where this looked. Six more are read at import time
 * by the modules that use them, and this check had never seen any of them.
 *
 * Two were documented as settable and reached nothing: `SONE_PASSWORD_COST`,
 * which `.env.example` invites with a paragraph about what raising it costs,
 * and `SONE_VERSION_RETENTION_DAYS`, which `docs/deployment.md` names. The
 * exact fault the check exists to catch, in the variables it did not look at,
 * with an exception entry in this file for one of them — a name the reader had
 * never produced, so the entry excused nothing and read like it did.
 *
 * So it reads the whole server now. The cost is that a name in a *string* looks
 * like a name that is read; the exception lists below say which those are, one
 * decision per line.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

/*
 * The tree to read, pointed elsewhere only so a test can watch this fail.
 *
 * A guard nobody has seen catch anything is a guard nobody should believe, and
 * this one had been passing for months while missing six variables.
 */
const ROOT = process.argv[2] ?? '.';
const example = await readFile(path.join(ROOT, '.env.example'), 'utf8');
const compose = await readFile(path.join(ROOT, 'docker-compose.yml'), 'utf8');

/** Every `.ts` under a directory. */
async function* sources(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* sources(full);
    else if (entry.name.endsWith('.ts')) yield full;
  }
}

const names = new Set();
for await (const file of sources(path.join(ROOT, 'packages', 'server', 'src'))) {
  const text = await readFile(file, 'utf8');
  // Single-quoted, which is how every one of these is read: `process.env['X']`
  // or a helper taking the name. A mention in prose uses backticks and is not
  // matched, which is the difference between a variable that is read and one
  // that is talked about.
  for (const match of text.matchAll(/'(SONE_[A-Z0-9_]+)'/g)) names.add(match[1]);
}
const read = [...names].sort();

/**
 * Variables that belong in one place and not the other, by decision.
 *
 * Each is listed by name rather than matched by a pattern, so adding to this is
 * a decision somebody makes rather than a rule that quietly widens.
 */
const NOT_IN_EXAMPLE = new Set([
  // Compose builds it from POSTGRES_PASSWORD; an operator setting it by hand in
  // `.env` would be setting it twice and disagreeing with itself.
  'SONE_DATABASE_URL',
  // Fixed by the image's volume layout, not a choice.
  'SONE_STORAGE_PATH',
]);

const NOT_IN_COMPOSE = new Set([
  // A one-start escape hatch, deliberately awkward: `docker compose run -e …`
  // rather than a line somebody leaves in a file for a year (ADR-0013).
  'SONE_ALLOW_DOWNGRADE',
]);

/**
 * Set by the image build, not by whoever runs it.
 *
 * `build-image.yml` passes the version and the commit as build arguments, so
 * they are baked in. An operator naming them in `.env` would be relabelling
 * their own instance, which is the opposite of what the health endpoint is for.
 */
const FROM_THE_BUILD = new Set(['SONE_VERSION', 'SONE_COMMIT']);

const problems = [];
for (const name of read) {
  if (FROM_THE_BUILD.has(name)) continue;
  if (!example.includes(name) && !NOT_IN_EXAMPLE.has(name)) {
    problems.push(`${name} is read but not in .env.example`);
  }
  if (!compose.includes(name) && !NOT_IN_COMPOSE.has(name)) {
    problems.push(`${name} is read but not passed through in docker-compose.yml`);
  }
}

// Prove the check can fail before trusting that it passed. The floor is a count
// of what the whole server reads rather than what one file does, which is the
// number that moved (ADR-0112).
// Only for the real tree: a fixture is deliberately small, and asserting a
// floor against one would be asserting the fixture.
if (!process.argv[2] && (!read.includes('SONE_SECRET_KEY') || read.length < 25)) {
  console.error(
    `[check] only found ${read.length} variables in the server source — the reader is broken`,
  );
  process.exit(1);
}

if (problems.length > 0) {
  console.error('[check] variables an operator cannot set:');
  for (const one of problems) console.error(`  ${one}`);
  console.error(
    '\nA variable the server reads and compose does not name never reaches the\n' +
      'container, whatever the operator put in .env.',
  );
  process.exit(1);
}

console.log(`[check] ${read.length} environment variables, all reachable — ok`);
