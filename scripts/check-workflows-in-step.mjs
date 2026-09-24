#!/usr/bin/env node
/**
 * SONE — check that the two copies of the test workflow stay in step.
 *
 * The repository is built on two forges. GitHub is where it is published, and
 * `actions/checkout` is first-party there. Forgejo is where the work happens,
 * and there the action has to resolve through that instance's mirror — which
 * is why the Forgejo copy has always cloned by hand (ADR-0196).
 *
 * That is the *only* difference either file is allowed to have. Everything
 * else — the service container, the fourteen guards, the migration replay,
 * the boot check — must be identical, because a guard that runs on one forge
 * and not the other is a guard you find out about on the wrong day.
 *
 * Two copies of a two-hundred-line file drift. This is the thing that notices.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const files = {
  github: '.github/workflows/test.yml',
  forgejo: '.forgejo/workflows/test.yml',
};

/*
 * Cut the check-out step out of a workflow and leave a marker.
 *
 * A step runs from its own `- name:` to the next one at the same indentation.
 * Matched on the literal two-space-dash-six-space shape the file uses rather
 * than with a YAML parser: the comments *are* the reasoning here, and every
 * parser in reach drops them, which would make a diff of comment-only drift
 * invisible — the kind most worth catching.
 */
function withoutCheckout(source, where) {
  const start = source.indexOf('      - name: Check out\n');
  if (start === -1) {
    throw new Error(`${where}: no step called "Check out"`);
  }
  const next = source.indexOf('\n      - name: ', start + 1);
  if (next === -1) {
    throw new Error(`${where}: the "Check out" step is the last one, which it never was`);
  }
  return `${source.slice(0, start)}      - name: Check out\n<<checkout>>${source.slice(next)}`;
}

const problems = [];

const sources = {};
for (const [forge, file] of Object.entries(files)) {
  try {
    sources[forge] = readFileSync(path.join(root, file), 'utf8');
  } catch {
    problems.push(`${file} is missing — both forges need a test workflow`);
  }
}

if (problems.length === 0) {
  const github = withoutCheckout(sources.github, files.github);
  const forgejo = withoutCheckout(sources.forgejo, files.forgejo);

  if (github !== forgejo) {
    // Which line, not just "they differ": the file is long enough that
    // "somewhere in here" is not an answer anybody can act on.
    const a = github.split('\n');
    const b = forgejo.split('\n');
    const at = a.findIndex((line, index) => line !== b[index]);
    problems.push(
      `${files.github} and ${files.forgejo} differ outside the check-out step, ` +
        `first at line ${at + 1}:\n` +
        `    github:  ${a[at] ?? '(file ends)'}\n` +
        `    forgejo: ${b[at] ?? '(file ends)'}`,
    );
  }

  // The one difference that is meant to be there, asserted rather than assumed:
  // if both ever grow the same check-out step, one of the two forges is about
  // to stop working and nothing else here would say so.
  if (!sources.github.includes('uses: actions/checkout@')) {
    problems.push(`${files.github} no longer uses actions/checkout — see ADR-0196`);
  }
  if (sources.forgejo.includes('uses: actions/checkout@')) {
    problems.push(
      `${files.forgejo} uses actions/checkout, which is what ADR-0196 keeps it away from`,
    );
  }
}

if (problems.length > 0) {
  console.error('[check] the two test workflows are out of step:\n');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('');
  process.exit(1);
}

console.log('[check] both test workflows agree, apart from how they check out — ok');
