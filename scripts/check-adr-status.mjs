#!/usr/bin/env node
/**
 * A record that says "nothing built yet" about something that ships is worse
 * than a record with no status: the next reader takes it for a plan.
 *
 * This cannot tell whether a feature exists — nothing mechanical can. What it
 * can do is notice the combination that has actually gone wrong: an ADR still
 * claiming nothing is built, while commits naming that ADR have landed since
 * the line was written.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const stale = [];

for (const name of readdirSync('docs/adr').filter((one) => one.endsWith('.md'))) {
  const text = readFileSync(`docs/adr/${name}`, 'utf8');
  const status = /## Status\s+([^\n]+)/.exec(text)?.[1] ?? '';
  if (!/nothing built yet/i.test(status)) continue;

  const number = /^(\d{4})/.exec(name)?.[1];
  if (!number) continue;

  // Commits naming this ADR, excluding the one that added the record itself.
  const log = execFileSync('git', ['log', '--oneline', `--grep=ADR-${number}`], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter((line) => line !== '' && !/^\w+ Decide /.test(line));

  if (log.length > 0) stale.push({ name, commits: log.length });
}

if (stale.length > 0) {
  console.error('[check] records saying nothing is built, with commits that built it:');
  for (const one of stale) console.error(`  ${one.name} — ${one.commits} commit(s)`);
  console.error('\nUpdate the Status line, or the next reader takes the record for a plan.');
  process.exit(1);
}

console.log('[check] no record claims to be unbuilt while its commits exist — ok');
