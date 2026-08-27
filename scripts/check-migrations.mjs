#!/usr/bin/env node
/**
 * Validate migration files before they can break a deployment.
 *
 * Each file is expected to wrap itself in BEGIN/COMMIT and insert its own
 * schema_migrations row. That is a convention with no enforcement, and the
 * consequence of forgetting it is out of all proportion to the mistake: the
 * changes apply, nothing is recorded, and every subsequent start retries the
 * migration and fails on "already exists". The server never boots, and the only
 * visible symptom is a blank page.
 *
 * That happened with 0007_folders on a deployed instance. The runner now
 * records the version itself as a safety net, but a file that does not declare
 * its own version is still wrong — and the mismatch case, where a file records
 * a version that is not its filename, the runner cannot fix.
 *
 * Deliberately narrow. A previous version of this script also tried to flag
 * semicolons inside string literals, on the theory that they break statement
 * splitting. Two things were wrong with that: distinguishing a string literal
 * from an apostrophe in a comment needs a real SQL parser, so it flagged
 * "parent's" in every file; and nothing in SONE splits on semicolons — the
 * whole file is handed to Postgres in one query. A check that produces false
 * positives is worse than no check, because it teaches people to ignore the
 * output.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'db', 'migrations');

const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
if (files.length === 0) {
  console.error(`[check] no migrations found in ${dir}`);
  process.exit(1);
}

const problems = [];

for (const filename of files) {
  const version = filename.replace(/\.sql$/, '');
  const sql = await readFile(path.join(dir, filename), 'utf8');
  const say = (message) => problems.push(`${filename}: ${message}`);

  if (!/^\s*BEGIN\s*;/im.test(sql)) {
    say('no BEGIN — a partial apply cannot be rolled back');
  }
  if (!/COMMIT\s*;/i.test(sql)) {
    say('no COMMIT — the transaction is never closed');
  }

  const inserts = [...sql.matchAll(/INSERT\s+INTO\s+schema_migrations[\s\S]*?VALUES\s*\(\s*'([^']+)'/gi)];
  if (inserts.length === 0) {
    say(
      'does not record itself in schema_migrations. Without it the migration ' +
        'applies, is never recorded, and every restart retries and fails — the ' +
        'server stops booting.',
    );
  } else {
    for (const match of inserts) {
      if (match[1] !== version) {
        // The runner's safety net cannot catch this: a row exists, so it looks
        // recorded, but under the wrong version.
        say(`records version '${match[1]}' but the file is '${version}'`);
      }
    }
  }
}

if (problems.length === 0) {
  console.log(`[check] ${files.length} migration(s) well-formed — ok`);
  process.exit(0);
}

console.error('[check] migration problems:\n');
for (const problem of problems) console.error(`  ${problem}`);
console.error('');
process.exit(1);
