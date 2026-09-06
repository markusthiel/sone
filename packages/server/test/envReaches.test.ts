/**
 * The guard that keeps a setting from being one nobody can set (ADR-0112).
 *
 * `scripts/check-env-reaches-container.mjs` fails the build when a variable the
 * server reads is missing from `.env.example` or from the compose service's
 * `environment:` block — because compose does not forward the host's
 * environment, so a name it does not list never reaches the container whatever
 * an operator put in `.env`.
 *
 * It had been passing while six variables were in exactly that position,
 * because it read one source file. A guard nobody has seen catch anything is a
 * guard nobody should believe; these are the tests that watch it catch.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(
  new URL('../../../scripts/check-env-reaches-container.mjs', import.meta.url),
);
const repo = fileURLToPath(new URL('../../..', import.meta.url));

const run = (root?: string): { code: number; err: string } => {
  const result = spawnSync(process.execPath, root ? [script, root] : [script], {
    encoding: 'utf8',
    cwd: repo,
  });
  return { code: result.status ?? -1, err: `${result.stderr}${result.stdout}` };
};

/** A tree with one server source, one example file and one compose file. */
function tree(source: string, example: string, compose: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'sone-reaches-'));
  mkdirSync(path.join(dir, 'packages', 'server', 'src'), { recursive: true });
  writeFileSync(path.join(dir, 'packages', 'server', 'src', 'a.ts'), source);
  writeFileSync(path.join(dir, '.env.example'), example);
  writeFileSync(path.join(dir, 'docker-compose.yml'), compose);
  return dir;
}

test('it fails on a variable compose does not forward', () => {
  /*
   * The fault itself: the name is in the file an operator copies, so they set
   * it, and nothing carries it into the container. Six variables were in this
   * position — two of them documented as settable.
   */
  const dir = tree(
    `const n = process.env['SONE_JOB_RESULT_HOURS'];\n`,
    `# SONE_JOB_RESULT_HOURS=24\n`,
    `services:\n  app:\n    environment:\n      SONE_PUBLIC_URL: x\n`,
  );

  try {
    const { code, err } = run(dir);
    assert.equal(code, 1, 'the build stops');
    assert.match(err, /SONE_JOB_RESULT_HOURS/);
    assert.match(err, /docker-compose\.yml/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('and on one an operator is never told about', () => {
  const dir = tree(
    `const n = process.env['SONE_SOMETHING_NEW'];\n`,
    `# nothing here\n`,
    `services:\n  app:\n    environment:\n      SONE_SOMETHING_NEW: x\n`,
  );

  try {
    const { code, err } = run(dir);
    assert.equal(code, 1);
    assert.match(err, /not in \.env\.example/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('it reads the whole server, not only the file settings are parsed in', () => {
  /*
   * The change (ADR-0112). This variable is read in a module of its own, which
   * is where all six of the missing ones were read — `config.ts` was the file
   * the original fourteen were found in, so it was the file this looked at.
   */
  const dir = mkdtempSync(path.join(tmpdir(), 'sone-reaches-'));
  mkdirSync(path.join(dir, 'packages', 'server', 'src', 'jobs'), { recursive: true });
  writeFileSync(path.join(dir, 'packages', 'server', 'src', 'config.ts'), `// nothing here\n`);
  writeFileSync(
    path.join(dir, 'packages', 'server', 'src', 'jobs', 'runner.ts'),
    `const n = process.env['SONE_DEEP'];\n`,
  );
  writeFileSync(path.join(dir, '.env.example'), `# SONE_DEEP=1\n`);
  writeFileSync(path.join(dir, 'docker-compose.yml'), `services:\n  app:\n`);

  try {
    const { code, err } = run(dir);
    assert.equal(code, 1, 'a nested module counts');
    assert.match(err, /SONE_DEEP/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a name only talked about is not a name that is read', () => {
  // The cost of reading the whole tree: prose mentions variables. Backticks in
  // a comment are how this repository writes them, and single quotes are how it
  // reads them, so that is the line the check draws.
  const dir = tree(
    '// `SONE_S3_BUCKET` was never implemented; see ADR-0107.\nexport const x = 1;\n',
    `# nothing\n`,
    `services:\n  app:\n`,
  );

  try {
    assert.equal(run(dir).code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('and it passes on the tree this repository actually has', () => {
  // The other half: a guard that fails on everything is as useless as one that
  // fails on nothing.
  const { code, err } = run();
  assert.equal(code, 0, err);
});
