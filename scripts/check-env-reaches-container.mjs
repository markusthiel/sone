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
 */

import { readFile } from 'node:fs/promises';

const config = await readFile('packages/server/src/config.ts', 'utf8');
const example = await readFile('.env.example', 'utf8');
const compose = await readFile('docker-compose.yml', 'utf8');

const read = [...new Set([...config.matchAll(/'(SONE_[A-Z0-9_]+)'/g)].map((m) => m[1]))].sort();

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
  // The test suite's own knob. A running instance should not set it, and a line
  // in compose is an invitation to.
  'SONE_PASSWORD_COST',
]);

const problems = [];
for (const name of read) {
  if (!example.includes(name) && !NOT_IN_EXAMPLE.has(name)) {
    problems.push(`${name} is read but not in .env.example`);
  }
  if (!compose.includes(name) && !NOT_IN_COMPOSE.has(name)) {
    problems.push(`${name} is read but not passed through in docker-compose.yml`);
  }
}

// Prove the check can fail before trusting that it passed.
if (!read.includes('SONE_SECRET_KEY') || read.length < 15) {
  console.error(`[check] only found ${read.length} variables in config.ts — the reader is broken`);
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
