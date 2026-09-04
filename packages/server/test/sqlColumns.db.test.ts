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

/*
 * A literal that *begins* with SQL, in one of its real forms.
 *
 * Two false-positive sources, both found by reading what the check had
 * collected rather than by trusting its silence:
 *
 * - `` `[^`]*` `` matches the text *between* two unrelated template literals,
 *   so ordinary JavaScript was being scanned as SQL. Anchoring at the start of
 *   the literal fixes it.
 * - `WITH` is also an English word, so a JSDoc block beginning "with no numeric
 *   part…" was read as a statement. The real form is `WITH name AS (`.
 *
 * Together those took the unchecked references from 76 to 26.
 */
const STATEMENT =
  /`(\s*(?:--[^\n]*\n\s*)*(?:SELECT\s|INSERT\s+INTO\s|UPDATE\s+[a-z_]+\s|DELETE\s+FROM\s|WITH\s+[a-z_]+\s+AS\s*\()[^`]*)`/gis;
const TARGET = /(?:FROM|JOIN|UPDATE|INTO)\s+([a-z_]+)(?:\s+(?:AS\s+)?([a-z][a-z_]*))?/gi;
const REFERENCE = /\b([a-z][a-z_]*)\.([a-z_]+)\b/g;

/**
 * Which columns a statement names, resolved through its own aliases — and how
 * many references it could not resolve.
 *
 * The second number is the point. An unresolved prefix means the reference is
 * *not checked*, and a checker that does not say how much it skipped is a
 * checker whose silence means nothing.
 */
export function columnsNamed(
  sql: string,
  tables: ReadonlySet<string>,
): { named: string[]; unresolved: string[] } {
  // Comments hold prose and interpolations hold JavaScript; neither is SQL, and
  // both were producing nonsense before they were stripped — "silently" and
  // "the" appeared in an earlier version's list of table names.
  const body = sql.replace(/--[^\n]*/g, '').replace(/\$\{[^}]*\}/g, ' ');
  const alias = new Map<string, string>();
  for (const [, table, short] of body.matchAll(TARGET)) {
    if (!table || !tables.has(table)) continue;
    alias.set(short ?? table, table);
    alias.set(table, table);
  }

  // Names a statement defines for itself: a CTE, or a subquery's alias. Out of
  // scope by decision rather than by accident — resolving them means parsing
  // SQL, and this is a reader, not a parser.
  const own = new Set([
    ...[...body.matchAll(/(?:WITH|,)\s*([a-z_][a-z_0-9]*)\s+AS\s*\(/gi)].map((one) => one[1]),
    ...[...body.matchAll(/\)\s+(?:AS\s+)?([a-z][a-z_0-9]*)/gi)].map((one) => one[1]),
  ]);

  const named: string[] = [];
  const unresolved: string[] = [];
  for (const [, prefix, column] of body.matchAll(REFERENCE)) {
    if (!prefix || !column) continue;
    const table = alias.get(prefix);
    if (table) named.push(`${table}.${column}`);
    else if (!own.has(prefix)) unresolved.push(`${prefix}.${column}`);
  }
  return { named, unresolved };
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
      wrong.named.some((one) => !known.has(one)),
      'a wrong column is noticed',
    );

    const right = columnsNamed(
      `SELECT p.title FROM pages p JOIN users u ON u.id = p.last_edited_by`,
      tables,
    );
    assert.deepEqual(
      right.named.filter((one) => !known.has(one)),
      [],
      'correct SQL is not flagged',
    );
  });

  test('no statement in the server names a column the schema lacks', () => {
    const missing: string[] = [];
    for (const file of sources(new URL('../src/', import.meta.url))) {
      for (const [, sql] of file.text.matchAll(STATEMENT)) {
        if (!sql) continue;
        for (const ref of columnsNamed(sql, tables).named) {
          if (!known.has(ref)) missing.push(`${file.name}: ${ref}`);
        }
      }
    }
    assert.deepEqual([...new Set(missing)].sort(), []);
  });
  
  test('and it says how much it did not check', () => {
    /*
     * A ratchet on the blind spot, not a pass mark.
     *
     * 27 references sit behind a prefix this reader cannot resolve — a CTE's
     * inner alias, a subquery's name. Those are *not checked*, and a checker
     * that does not say so has a silence that means nothing. The number may
     * fall; if it rises, somebody has written SQL this cannot see into, and
     * that is worth one minute of their attention rather than a surprise later.
     */
    let unresolved = 0;
    for (const file of sources(new URL('../src/', import.meta.url))) {
      for (const [, sql] of file.text.matchAll(STATEMENT)) {
        if (!sql) continue;
        unresolved += columnsNamed(sql, tables).unresolved.length;
      }
    }
    assert.ok(
      unresolved <= 27,
      `${unresolved} unchecked references, was 26 — new SQL this reader cannot see into`,
    );
  });

  /*
   * And the reverse question: which columns exist that no code names?
   *
   * The check above catches a column the code invents. This one catches a
   * column the *schema* invents — and it found two lies rather than dead space:
   * `users.avatar_url`, superseded by 0026_avatar and never dropped, and the
   * whole `password_resets` table, which no line of server code touched. A
   * table shaped like a security feature that does not exist is worse than an
   * absent one, because the next person to read the schema concludes resets are
   * handled.
   *
   * The allowance below is for columns nothing *names* but something uses: view
   * columns selected by the view's own definition, and bookkeeping written by a
   * default. Each one is listed rather than pattern-matched, so adding to it is
   * a decision somebody makes on purpose.
   */
  const UNREAD_ON_PURPOSE = new Set([
    // Admin views; their columns are produced by the view definition itself.
    'document_schema_census.newest_edit',
    'document_schema_census.oldest_edit',
    'pages_inside_pages.child_id',
    'pages_inside_pages.child_kind',
    'pages_inside_pages.child_title',
    'pages_inside_pages.parent_title',
    // Written by their column default, read by a human looking at the table.
    'group_members.added_at',
    'schema_migrations.applied_at',
    // Same kind: the code needs only whether a stage was sent, and the
    // timestamp is for an operator asking "when did this instance start
    // nagging people" (ADR-0065).
    'requirement_mails.sent_at',
    // The four superseded mail columns were here, allowed for one release with
    // "drop after 0.7.0" written beside them. 0053 dropped them and these four
    // lines went in the same commit.
  ]);

  test('the schema names no column the code has forgotten', async () => {
    const { rows } = await db.query<{ ref: string }>(
      `SELECT table_name || '.' || column_name AS ref
         FROM information_schema.columns WHERE table_schema = 'public'`,
    );

    /*
     * `.text`, because this file's `sources` returns records rather than
     * strings — my first version interpolated the object and searched
     * "[object Object]" 327 times, reporting 312 forgotten columns. A check
     * that fails wholesale is easier to disbelieve than one that fails once,
     * which is the only reason I looked instead of adding an allowance.
     */
    let code = '';
    for (const file of sources(new URL('../src/', import.meta.url))) code += `${file.text}\n`;
    for (const file of sources(new URL('../../core/src/', import.meta.url))) {
      code += `${file.text}\n`;
    }

    const forgotten = rows
      .map((row) => row.ref)
      .filter((ref) => !UNREAD_ON_PURPOSE.has(ref))
      .filter((ref) => {
        const column = ref.split('.')[1] ?? '';
        return !new RegExp(`\\b${column}\\b`).test(code);
      });

    assert.deepEqual(forgotten.sort(), []);
  });
},
);