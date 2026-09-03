/**
 * Every column the server's SQL names exists in the schema.
 *
 * Written because this session lost twice to the same thing. `LEFT JOIN users a
 * ON a.id = n.actor_id` typechecked perfectly and failed at runtime, because
 * `notifications` had no such column — and the mail job would have shipped and
 * broken on the first send. TypeScript cannot see inside a template literal, so
 * a wrong column name is caught by Postgres, at the moment the query runs, on
 * whatever path happens to be exercised.
 *
 * This closes that gap for the ordinary case: a reference of the form
 * `alias.column` where the alias resolves to a real table through the
 * statement's own FROM/JOIN/UPDATE/INTO clause.
 *
 * What it deliberately does not attempt: CTE names, subquery aliases, computed
 * columns, `information_schema`, and anything built by string concatenation. A
 * checker that tried would produce false positives, and a check somebody has to
 * argue with is a check they turn off. Silence here means "nothing obviously
 * wrong", not "the SQL is correct".
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import type { Pool } from 'pg';

import { closeTestPool, getTestPool, hasDatabase } from './support/db.js';

function sources(dir: URL): Array<{ name: string; text: string }> {
  const out: Array<{ name: string; text: string }> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
    if (entry.isDirectory()) out.push(...sources(child));
    else if (entry.name.endsWith('.ts')) {
      out.push({ name: entry.name, text: readFileSync(child, 'utf8') });
    }
  }
  return out;
}

const STATEMENT = /`([^`]*(?:SELECT|INSERT|UPDATE|DELETE)[^`]*)`/gis;
const TARGET = /(?:FROM|JOIN|UPDATE|INTO)\s+([a-z_]+)(?:\s+(?:AS\s+)?([a-z][a-z_]*))?/gi;
const REFERENCE = /\b([a-z][a-z_]*)\.([a-z_]+)\b/g;

/** Which columns a statement names, resolved through its own aliases. */
export function columnsNamed(sql: string, tables: ReadonlySet<string>): string[] {
  const alias = new Map<string, string>();
  for (const [, table, short] of sql.matchAll(TARGET)) {
    if (!table || !tables.has(table)) continue;
    alias.set(short ?? table, table);
    alias.set(table, table);
  }

  const out: string[] = [];
  for (const [, prefix, column] of sql.matchAll(REFERENCE)) {
    const table = prefix ? alias.get(prefix) : undefined;
    if (table && column) out.push(`${table}.${column}`);
  }
  return out;
}

// `hasDatabase` is a boolean, not a function, and the skip goes on the describe
// — which is how every other database suite here is written. I called it.
describe(
  'the SQL names columns that exist',
  { skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
  let db: Pool;
  let known: Set<string>;
  let tables: Set<string>;

  before(async () => {
    db = await getTestPool();
    const { rows } = await db.query<{ ref: string; table_name: string }>(
      `SELECT table_name || '.' || column_name AS ref, table_name
         FROM information_schema.columns WHERE table_schema = 'public'`,
    );
    known = new Set(rows.map((row) => row.ref));
    tables = new Set(rows.map((row) => row.table_name));
  });

  after(async () => {
    await closeTestPool();
  });

  test('the check can fail, which is the only reason to trust it passing', () => {
    // The mistake this session actually made, put back on purpose. A guard that
    // has never been seen to catch anything is a guard nobody should believe.
    const wrong = columnsNamed(
      `SELECT n.kind FROM notifications n LEFT JOIN users a ON a.id = n.actor_id_typo`,
      tables,
    );
    assert.ok(
      wrong.some((one) => !known.has(one)),
      'a wrong column is noticed',
    );

    const right = columnsNamed(
      `SELECT p.title FROM pages p JOIN users u ON u.id = p.last_edited_by`,
      tables,
    );
    assert.deepEqual(
      right.filter((one) => !known.has(one)),
      [],
      'correct SQL is not flagged',
    );
  });

  test('no statement in the server names a column the schema lacks', () => {
    const missing: string[] = [];
    for (const file of sources(new URL('../src/', import.meta.url))) {
      for (const [, sql] of file.text.matchAll(STATEMENT)) {
        if (!sql) continue;
        for (const ref of columnsNamed(sql, tables)) {
          if (!known.has(ref)) missing.push(`${file.name}: ${ref}`);
        }
      }
    }
    assert.deepEqual([...new Set(missing)].sort(), []);
  });
  },
);
