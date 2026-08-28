#!/usr/bin/env node
/**
 * SONE — check that scripts/verify-image.py actually works.
 *
 * verify-image.py runs only in the image workflow, after a build. So a mistake
 * in it costs a full build to discover, and it is discovered in CI rather than
 * here — which is what happened: a variable was removed and the line printing
 * it was left behind, and the script died with a NameError after the image had
 * been built and verified. Everything it checked was correct; the reporting was
 * not.
 *
 * `python3 -m py_compile` would not have caught it either, and neither did the
 * `ast.parse` I ran instead. A NameError on an untaken-until-then path needs the
 * code to be *executed*.
 *
 * So this feeds it a correct image description and four broken ones, and
 * asserts the verdicts. It runs with the other checks, before anything is
 * built.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, 'verify-image.py');
const workDir = mkdtempSync(path.join(tmpdir(), 'sone-verify-'));

/** A `docker inspect` result for an image that should pass. */
const healthy = () => ({
  Healthcheck: { Test: ['CMD', 'node', 'docker/healthcheck.mjs'] },
  ExposedPorts: { '3000/tcp': {} },
  Env: ['SONE_VERSION=0.1.0-rc.1'],
  Entrypoint: ['docker/entrypoint.sh'],
  Cmd: [],
});

const cases = [
  { name: 'a correct image', config: healthy(), expect: 0 },
  {
    name: 'a dropped healthcheck',
    config: { ...healthy(), Healthcheck: null },
    expect: 1,
  },
  {
    // The one that matters most now: the image declares no USER, so the
    // entrypoint is the only thing standing between the server and root.
    name: 'an entrypoint that bypasses the privilege drop',
    config: { ...healthy(), Entrypoint: ['node'], Cmd: ['packages/server/dist/main.js'] },
    expect: 1,
  },
  { name: 'an unexposed port', config: { ...healthy(), ExposedPorts: {} }, expect: 1 },
  {
    name: 'a version that was not baked in',
    config: { ...healthy(), Env: ['SONE_VERSION=dev'] },
    expect: 1,
  },
];

let failures = 0;

for (const testCase of cases) {
  const file = path.join(workDir, 'inspect.json');
  writeFileSync(file, JSON.stringify([{ Config: testCase.config }]));

  const result = spawnSync('python3', [script, file], { encoding: 'utf8' });

  if (result.error) {
    console.error(`[check] could not run verify-image.py: ${result.error.message}`);
    process.exit(2);
  }

  const output = `${result.stdout}${result.stderr}`;

  // A traceback means the script broke rather than judged, which is the failure
  // this check exists for and is invisible in the exit code alone: a Python
  // crash also exits non-zero.
  if (output.includes('Traceback')) {
    console.error(`[check] verify-image.py crashed on ${testCase.name}:`);
    console.error(output.trim());
    failures += 1;
    continue;
  }

  if (result.status !== testCase.expect) {
    console.error(
      `[check] ${testCase.name}: expected exit ${testCase.expect}, got ${result.status}`,
    );
    console.error(output.trim());
    failures += 1;
  }
}

rmSync(workDir, { recursive: true, force: true });

if (failures > 0) {
  console.error(`[check] verify-image.py — ${failures} case(s) wrong`);
  process.exit(1);
}

console.log(`[check] verify-image.py judges ${cases.length} image(s) correctly — ok`);
