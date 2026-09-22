#!/usr/bin/env node
/**
 * SONE — a workflow may only run tools this workspace installs.
 *
 * The test workflow was red for two hundred and ninety-five consecutive runs,
 * across five days, eight merges and a release, on one line:
 *
 *     run: npx tsx scripts/check-version.mts
 *
 * `tsx` is a devDependency of all five packages and of none of them at the
 * root, so a clean checkout has no `node_modules/.bin/tsx`. The runner said
 * `sh: 1: tsx: not found` and stopped, thirteen steps in, before typecheck,
 * before the build, before a single test.
 *
 * It passed on my machine for the worst possible reason: `tsx` was installed
 * globally there by something else entirely, months earlier. npx puts the
 * global bin directory on the path, so the command resolved — to a binary that
 * has never been part of this repository and is not named in any manifest.
 *
 * That is the class this checks. A step that reaches for a tool through `npx`
 * or `pnpm exec` gets one of three outcomes, and only one of them is a build:
 *
 *   - the workspace installs it, and it runs;
 *   - something outside the workspace happens to provide it, and it runs, and
 *     the result depends on a machine rather than on this repository;
 *   - nothing provides it, and the job dies at that line.
 *
 * The first is the only acceptable one, and it is decidable without running
 * anything: look in the root `node_modules/.bin`. That is the directory a
 * clean checkout gets from `pnpm install`, and nothing else — not a global
 * install, not a laptop, not a runner image — can put anything into it.
 *
 * `pnpm dlx` is rejected outright: it fetches from the registry every time by
 * definition, so a build using it is a build that fails when the registry is
 * unreachable, which is exactly the day you most want to build.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflows = path.join(root, '.github', 'workflows');
const binDir = path.join(root, 'node_modules', '.bin');

const failures = [];

/**
 * Where a tool is asked for. Deliberately not a shell parser.
 *
 * A general parse of every command a workflow runs would be a large, wrong
 * program: `run:` blocks are arbitrary shell, with pipes, loops, heredocs and
 * conditionals. What matters here is narrower and syntactically obvious — the
 * two runners that resolve a *package's* binary rather than a system one, plus
 * the one that always downloads.
 */
const patterns = [
  { runner: 'npx', regex: /(?:^|[\s;&|(])npx\s+((?:--?[\w-]+\s+)*)([\w@./-]+)/g },
  { runner: 'pnpm exec', regex: /(?:^|[\s;&|(])pnpm\s+exec\s+([\w@./-]+)/g },
  { runner: 'pnpm dlx', regex: /(?:^|[\s;&|(])pnpm\s+dlx\s+([\w@./-]+)/g },
];

function binsAvailable() {
  if (!fs.existsSync(binDir)) return null;
  return new Set(fs.readdirSync(binDir));
}

const available = binsAvailable();
if (available === null) {
  /*
   * Not a failure. This check answers "would a clean checkout have it", and
   * with no node_modules at all there is nothing to compare against — running
   * it before `pnpm install` is a mistake in the caller, not in the workflows.
   */
  console.log('[check] ci tools — skipped, no node_modules/.bin yet');
  process.exit(0);
}

for (const name of fs.readdirSync(workflows).sort()) {
  if (!name.endsWith('.yml') && !name.endsWith('.yaml')) continue;
  const file = path.join(workflows, name);
  const lines = fs.readFileSync(file, 'utf8').split('\n');

  lines.forEach((line, index) => {
    // Comments in these files are prose, and the prose discusses commands.
    const code = line.replace(/(^|\s)#.*$/, '');
    const where = `${name}:${index + 1}`;

    for (const { runner, regex } of patterns) {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(code)) !== null) {
        const tool = match[match.length - 1];

        if (runner === 'pnpm dlx') {
          failures.push(
            `${where}: \`pnpm dlx ${tool}\` downloads from the registry on every run. ` +
              'Add it to the root devDependencies and use `pnpm exec` instead.',
          );
          continue;
        }

        if (!available.has(tool)) {
          failures.push(
            `${where}: \`${runner} ${tool}\` — no \`${tool}\` in node_modules/.bin. ` +
              'A clean checkout has only what the ROOT package.json installs, so this ' +
              'either downloads silently or dies with "not found". Add it to the root ' +
              'devDependencies.',
          );
        }
      }
    }
  });
}

if (failures.length > 0) {
  console.error('[check] a workflow runs a tool this workspace does not install:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log('[check] ci tools — every tool a workflow runs is installed at the root');
