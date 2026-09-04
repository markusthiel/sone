#!/usr/bin/env node
/**
 * Cut a release.
 *
 * Replaces the checklist in docs/releasing.md with something that refuses to
 * proceed when a step was skipped. A checklist followed by a person at 23:00 is
 * a checklist with one step missing, and the missing step is usually the
 * changelog entry — the one thing a released tag cannot be fixed for
 * afterwards, because a released tag is never moved (ADR-0013).
 *
 *   node scripts/release.mjs 0.1.0
 *   node scripts/release.mjs 0.1.0-rc.1
 *   node scripts/release.mjs 0.2.0 --dry-run
 *
 * What it does NOT do: run the tests. They take minutes and belong in CI or in
 * a deliberate `pnpm -r test` beforehand; silently running them here would make
 * this command feel broken when it sits for two minutes.
 */

import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    'dry-run': { type: 'boolean', default: false },
    'allow-dirty': { type: 'boolean', default: false },
  },
});

const version = positionals[0];

if (!version) {
  console.error(`usage: release.mjs <version> [--dry-run] [--allow-dirty]

  version   without a leading v, e.g. 0.1.0 or 0.1.0-rc.1
`);
  process.exit(2);
}

// Semantic version with an optional pre-release. Deliberately strict: a typo
// here becomes a permanent tag.
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  fail(`"${version}" is not a valid version. Expected 0.1.0 or 0.1.0-rc.1.`);
}

const isPreRelease = version.includes('-');
const tag = `v${version}`;

const git = (...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

const checks = [];
const record = (label) => checks.push(label);

// --- working tree ----------------------------------------------------------

const status = git('status', '--porcelain');
if (status && !values['allow-dirty']) {
  fail(
    `the working tree has uncommitted changes:\n\n${status}\n\n` +
      `A tag points at a commit, so anything uncommitted is not in the release.\n` +
      `Commit first, or pass --allow-dirty if you know why.`,
  );
}
record('working tree clean');

const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
if (branch !== 'main') {
  console.warn(`⚠ releasing from "${branch}" rather than main`);
}

// --- the tag must not exist ------------------------------------------------

const existingTags = git('tag', '--list').split('\n').filter(Boolean);
if (existingTags.includes(tag)) {
  fail(
    `${tag} already exists. A released tag is never moved (ADR-0013);\n` +
      `if the release was broken, cut the next patch instead.`,
  );
}
record(`${tag} is unused`);

// --- version must move forwards -------------------------------------------

const compare = (a, b) => {
  const parse = (v) => {
    const [core, pre] = v.replace(/^v/, '').split('-');
    return { parts: core.split('.').map(Number), pre: pre ?? null };
  };
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i++) {
    const diff = (left.parts[i] ?? 0) - (right.parts[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  if (left.pre === right.pre) return 0;
  // A pre-release precedes its own release.
  if (left.pre === null) return 1;
  if (right.pre === null) return -1;
  return left.pre < right.pre ? -1 : 1;
};

const releaseTags = existingTags.filter((t) => /^v\d+\.\d+\.\d+/.test(t));
const newest = releaseTags.sort(compare).at(-1);
if (newest && compare(tag, newest) <= 0) {
  fail(`${tag} is not newer than the latest existing tag ${newest}.`);
}
record(newest ? `newer than ${newest}` : 'first release');

// --- changelog -------------------------------------------------------------

const changelogPath = path.join(root, 'CHANGELOG.md');
const changelog = await readFile(changelogPath, 'utf8');

// The heading may be "## 0.1.0" or "## Unreleased — 0.1.0-dev"; what matters is
// that this version is mentioned as a section, so the release has notes.
const hasEntry = new RegExp(`^##\\s.*\\b${version.replace(/\./g, '\\.')}\\b`, 'm').test(
  changelog,
);
if (!hasEntry) {
  fail(
    `CHANGELOG.md has no section mentioning ${version}.\n\n` +
      `Add one before tagging. The notes are the only part of a release that\n` +
      `cannot be added later, because the tag cannot be moved — and an\n` +
      `operator reading "what do I have to do to upgrade?" has nowhere else\n` +
      `to look (ADR-0013).`,
  );
}
record('changelog entry present');

/*
 * And that the section has entries in it, not only a heading.
 *
 * 0.4.0 was tagged with a section holding its summary, the operator note, and
 * the sentence "the features below need no configuration" — below which there
 * was nothing, because all twenty-three entries were still sitting under
 * "Unreleased" above it. The check above passed, because a heading existed.
 *
 * An operator reading the notes for the version they are installing is the one
 * reader who cannot go and look somewhere else.
 *
 * The threshold is **zero**, not two. It was two, and that was wrong: a release
 * fixing one thing has one entry, and this would have refused it — which is a
 * guard telling somebody their honest release notes are malformed.
 *
 * Two was over-fitting to 0.4.0, where the count was zero. The case where
 * entries exist but sit under the wrong heading is caught from the other side by
 * the "nothing stranded under Unreleased" check below, which is the pair that
 * actually covers it.
 */
const sectionBody = (() => {
  const start = changelog.search(
    new RegExp(`^##\\s.*\\b${version.replace(/\./g, '\\.')}\\b.*$`, 'm'),
  );
  if (start === -1) return '';
  const after = changelog.slice(start);
  const next = after.slice(1).search(/^## /m);
  return next === -1 ? after : after.slice(0, next + 1);
})();

const entryCount = (sectionBody.match(/^\*\*/gm) ?? []).length;
if (entryCount < 1) {
  fail(
    `CHANGELOG.md's ${version} section has ${entryCount} entr${entryCount === 1 ? 'y' : 'ies'}.\n\n` +
      `A heading is not notes. Check that the entries are under this version\n` +
      `rather than still under "Unreleased" — which is what happened to 0.4.0,\n` +
      `where the section ended on "the features below" and nothing followed.`,
  );
}
record(`changelog section has ${entryCount} entries`);

/*
 * And that "Unreleased" is empty of entries when a release is cut.
 *
 * The same fault seen from the other side: entries left there are entries the
 * release does not claim, and nobody looks under "Unreleased" for the notes of
 * a version they have installed.
 */
const unreleased = (() => {
  const start = changelog.search(/^## Unreleased\b.*$/m);
  if (start === -1) return '';
  const after = changelog.slice(start);
  const next = after.slice(1).search(/^## /m);
  return next === -1 ? after : after.slice(0, next + 1);
})();

const strays = (unreleased.match(/^\*\*/gm) ?? []).length;
if (strays > 0) {
  fail(
    `CHANGELOG.md still has ${strays} entr${strays === 1 ? 'y' : 'ies'} under "Unreleased".\n\n` +
      `Move them into the ${version} section. An entry left there is a change\n` +
      `this release made and does not mention.`,
  );
}
record('nothing stranded under Unreleased');

// --- package version -------------------------------------------------------

const manifestPath = path.join(root, 'package.json');
const manifestRaw = await readFile(manifestPath, 'utf8');
const manifest = JSON.parse(manifestRaw);
const previousVersion = manifest.version;

// --- report ----------------------------------------------------------------

console.log(`\nReleasing ${tag}${isPreRelease ? ' (pre-release)' : ''}\n`);
for (const check of checks) console.log(`  ✓ ${check}`);
console.log(`  · package.json ${previousVersion} → ${version}`);
if (isPreRelease) {
  console.log(`  · latest will NOT point at this: it is a pre-release`);
}

if (values['dry-run']) {
  console.log('\n--dry-run: nothing written.\n');
  process.exit(0);
}

// --- do it -----------------------------------------------------------------

manifest.version = version;
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
git('add', 'package.json');
git('commit', '-m', `Release ${version}`);

git('tag', '-a', tag, '-m', `SONE ${version}`);

console.log(`
✓ committed and tagged ${tag}

Next:

  git push origin main ${tag}

Then deploy that exact commit. No container image is required — point a
Portainer repository stack at the tag:

  Reference:     refs/tags/${tag}
  Compose path:  docker-compose.build.yml

If an image is wanted, the build-image workflow runs on version tags, but it
needs a runner with Docker daemon access (docs/actions-runner.md).

Afterwards, set the next development version on main:

  npm pkg set version=<next>-dev && git commit -am "Begin <next>"

Do this before the next push. Leaving the released version in place means git
describe produces <released>-<n>-g<sha>, which semantic versioning reads as a
PRE-RELEASE of the version just released — so the next build of main sorts BELOW
the release, the version fence reads it as a downgrade, and a running instance
refuses to start with a blank page. That has happened.
`);
