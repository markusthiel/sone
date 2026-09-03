/**
 * SONE server — the derived side of a relation (ADR-0054).
 *
 * A rollup names the relation column *on the other collection* that points
 * here, and what to do with the rows it finds. With no aggregate it lists them,
 * which is the backlink: "every row whose relation cell points at me".
 *
 * Nothing here writes. The reverse side of a relation cannot drift from the
 * forward side because it *is* the forward side, read the other way — which is
 * the decision the record turns on and the reason a symmetric write never
 * happens.
 */

import type { Pool } from 'pg';

import { queryRows } from '../db/pool.js';
import type { Value } from '@sone/core';

import { visiblePagesCondition } from '../pages/access.js';

/** What a rollup does with the rows it finds. */
export type Aggregate = 'rows' | 'count' | 'sum' | 'min' | 'max' | 'lookup';

export const AGGREGATES: ReadonlySet<Aggregate> = new Set<Aggregate>([
  'rows',
  'count',
  'sum',
  'min',
  'max',
  // Show a stored field of the linked rows rather than a number about them
  // (ADR-0054). The record said this "falls out of rollup for free"; it very
  // nearly did — the edges, the visibility and the config are the same, and
  // what it needed was a shape for the answer, because a list of somebody
  // else's *values* is not a list of rows and not a number.
  'lookup',
]);

export interface RollupConfig {
  /** The relation column on the other collection, pointing at this one. */
  viaFieldId: string;
  aggregate: Aggregate;
  /**
   * Which stored field to aggregate, for sum/min/max.
   *
   * A *stored* field, never another derived one — the rule that removes cycles
   * by construction rather than detecting them (ADR-0054). Checked when the
   * column is created, so nothing here has to walk a dependency graph.
   */
  fieldId?: string;
}

export interface DerivedValue {
  kind: 'derived';
  /** Rows, for a backlink. */
  rows?: Array<{ id: string; title: string }>;
  /** A number, for count/sum/min/max. */
  number?: number | null;
  /** Values from the linked rows, for a lookup. */
  texts?: string[];
  /**
   * Whether anything was left out because the reader may not see it.
   *
   * A relation crosses pages, so it crosses permissions: two people can see
   * different counts on the same page. That is correct, and it will look like a
   * bug the first time somebody notices — so the number says when it is partial
   * rather than letting somebody compare two screens and conclude the software
   * is wrong.
   */
  partial?: boolean;
  /**
   * A formula that could not be worked out, by reason (ADR-0056).
   *
   * In the value rather than instead of it: the cell shows the reason, per row,
   * because a formula can work for nine rows and fail on the tenth — and the
   * person reading that cell is the person who has to fix it.
   */
  error?: string;
  errorDetail?: string;
}

/** How many rows a backlink lists before it stops naming them. */
const MAX_BACKLINK_ROWS = 50;

export function readRollupConfig(config: Record<string, unknown> | null): RollupConfig | null {
  if (!config) return null;
  const via = config['viaFieldId'];
  const aggregate = config['aggregate'];
  if (typeof via !== 'string' || via === '') return null;
  if (typeof aggregate !== 'string' || !AGGREGATES.has(aggregate as Aggregate)) return null;
  const fieldId = config['fieldId'];
  return {
    viaFieldId: via,
    aggregate: aggregate as Aggregate,
    ...(typeof fieldId === 'string' && fieldId !== '' ? { fieldId } : {}),
  };
}

/**
 * Compute one rollup for every row of a collection.
 *
 * One query per rollup column rather than one per row: a table of two hundred
 * rows with two rollups is two queries, not four hundred. The edges come from
 * `page_relations`, whose inverse index makes this the lookup the record
 * assumed it was.
 *
 * The reader's visibility is in the query rather than applied afterwards,
 * because a filtered-out row must not contribute to a sum either — a total that
 * includes numbers from pages somebody cannot open is a way to read them.
 */
export async function computeRollup(
  pool: Pool,
  input: {
    rowIds: string[];
    config: RollupConfig;
    reader: { userId: string | null; isAdmin: boolean };
  },
): Promise<Map<string, DerivedValue>> {
  const out = new Map<string, DerivedValue>();
  if (input.rowIds.length === 0) return out;

  const visible = visiblePagesCondition('src', '$3', '$4');

  if (input.config.aggregate === 'rows' || input.config.aggregate === 'count') {
    const rows = await queryRows<{
      to_page_id: string;
      id: string;
      title: string;
      hidden: string;
    }>(
      pool,
      `WITH edges AS (
         SELECT r.to_page_id, r.from_page_id, src.title,
                (${visible}) AS may_read
           FROM page_relations r
           JOIN pages src ON src.id = r.from_page_id
          WHERE r.to_page_id = ANY($1::uuid[])
            AND r.field_id = $2
            AND src.archived_at IS NULL
       )
       SELECT to_page_id,
              from_page_id AS id,
              title,
              may_read::text AS hidden
         FROM edges
        ORDER BY title ASC`,
      [input.rowIds, input.config.viaFieldId, input.reader.userId, input.reader.isAdmin],
    );

    for (const rowId of input.rowIds) {
      const mine = rows.filter((row) => row.to_page_id === rowId);
      const readable = mine.filter((row) => row.hidden === 'true');
      const partial = readable.length !== mine.length;

      out.set(
        rowId,
        input.config.aggregate === 'count'
          ? { kind: 'derived', number: readable.length, ...(partial ? { partial: true } : {}) }
          : {
              kind: 'derived',
              rows: readable.slice(0, MAX_BACKLINK_ROWS).map((row) => ({
                id: row.id,
                title: row.title,
              })),
              ...(partial || readable.length > MAX_BACKLINK_ROWS ? { partial: true } : {}),
            },
      );
    }
    return out;
  }

  /*
   * A lookup: the linked rows' own values for one stored field.
   *
   * Text or number, whichever the shadow column holds — the projection already
   * writes both, so this needs no knowledge of field types beyond "not
   * derived", which was checked when the column was created.
   *
   * Empty values are dropped rather than shown as gaps: a lookup of six rows of
   * which two are blank reads better as four values than as "a, , b, , c, d".
   */
  if (input.config.aggregate === 'lookup') {
    const fieldId = input.config.fieldId;
    if (!fieldId) {
      for (const rowId of input.rowIds) out.set(rowId, { kind: 'derived', texts: [] });
      return out;
    }

    const found = await queryRows<{ to_page_id: string; shown: string | null }>(
      pool,
      `SELECT r.to_page_id,
              coalesce(v.text_value, v.number_value::text) AS shown
         FROM page_relations r
         JOIN pages src ON src.id = r.from_page_id
         JOIN page_properties v ON v.page_id = r.from_page_id AND v.field_id = $5
        WHERE r.to_page_id = ANY($1::uuid[])
          AND r.field_id = $2
          AND src.archived_at IS NULL
          AND (${visible})
        ORDER BY src.title ASC`,
      [input.rowIds, input.config.viaFieldId, input.reader.userId, input.reader.isAdmin, fieldId],
    );

    for (const rowId of input.rowIds) {
      const texts = found
        .filter((row) => row.to_page_id === rowId)
        .map((row) => row.shown)
        .filter((shown): shown is string => shown !== null && shown !== '');
      out.set(rowId, {
        kind: 'derived',
        texts: texts.slice(0, MAX_BACKLINK_ROWS),
        ...(texts.length > MAX_BACKLINK_ROWS ? { partial: true } : {}),
      });
    }
    return out;
  }

  // sum / min / max over a stored numeric field on the other side.
  const fieldId = input.config.fieldId;
  if (!fieldId) {
    for (const rowId of input.rowIds) out.set(rowId, { kind: 'derived', number: null });
    return out;
  }

  const totals = await queryRows<{ to_page_id: string; total: string | null; hidden: string }>(
    pool,
    `SELECT r.to_page_id,
            ${
              input.config.aggregate === 'sum'
                ? 'sum(v.number_value)'
                : input.config.aggregate === 'min'
                  ? 'min(v.number_value)'
                  : 'max(v.number_value)'
            }::text AS total,
            bool_or(NOT (${visible}))::text AS hidden
       FROM page_relations r
       JOIN pages src ON src.id = r.from_page_id
       JOIN page_properties v ON v.page_id = r.from_page_id AND v.field_id = $5
      WHERE r.to_page_id = ANY($1::uuid[])
        AND r.field_id = $2
        AND src.archived_at IS NULL
        -- The condition is inside the aggregate's own scope: a row somebody
        -- cannot read must not contribute to the total, or the number is a way
        -- to read it.
        AND (${visible})
      GROUP BY r.to_page_id`,
    [input.rowIds, input.config.viaFieldId, input.reader.userId, input.reader.isAdmin, fieldId],
  );

  for (const rowId of input.rowIds) {
    const found = totals.find((row) => row.to_page_id === rowId);
    out.set(rowId, {
      kind: 'derived',
      number: found?.total === null || found === undefined ? null : Number(found.total),
    });
  }
  return out;
}

/**
 * A stored cell or a rollup, as a formula sees it (ADR-0056).
 *
 * The bridge between two vocabularies: the projection stores `{kind:'number',
 * value}`-shaped cells and the formula language has its own four types. Written
 * out rather than shared, because the two are allowed to diverge — a cell can
 * gain a kind the formula language has no opinion about, and it should then be
 * blank to a formula rather than a crash.
 */
export function formulaValueOf(cell: unknown, derived: DerivedValue | undefined): Value {
  if (derived) {
    if (typeof derived.number === 'number') return { kind: 'number', value: derived.number };
    if (derived.texts) return { kind: 'text', value: derived.texts.join(', ') };
    if (derived.rows) return { kind: 'number', value: derived.rows.length };
    return { kind: 'blank' };
  }

  if (!cell || typeof cell !== 'object') return { kind: 'blank' };
  const value = cell as Record<string, unknown>;
  switch (value['kind']) {
    case 'number':
      return typeof value['value'] === 'number'
        ? { kind: 'number', value: value['value'] }
        : { kind: 'blank' };
    case 'checkbox':
      return { kind: 'boolean', value: value['value'] === true };
    case 'date':
      return typeof value['start'] === 'string'
        ? { kind: 'date', value: value['start'] }
        : { kind: 'blank' };
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return typeof value['value'] === 'string' && value['value'] !== ''
        ? { kind: 'text', value: value['value'] }
        : { kind: 'blank' };
    default:
      // A select, a relation, a files cell. Blank to a formula rather than an
      // invented number: "how many attachments" is a rollup's question.
      return { kind: 'blank' };
  }
}

/** A formula's answer, in the shape a derived cell is sent in. */
export function formulaResultOf(value: Value): DerivedValue {
  switch (value.kind) {
    case 'number':
      return { kind: 'derived', number: value.value };
    case 'text':
    case 'date':
      return { kind: 'derived', texts: [value.value] };
    case 'boolean':
      return { kind: 'derived', texts: [String(value.value)] };
    default:
      return { kind: 'derived', number: null };
  }
}
