/**
 * SONE — document migrations.
 *
 * The persisted document layout will change. This is the machinery that makes
 * that a non-event for the operator: migrations run lazily when a document is
 * opened, not as a batch job, and never require anyone to do anything.
 *
 * Three properties are non-negotiable, and each has a specific failure mode:
 *
 *   DETERMINISTIC  Two clients opening the same unmigrated document must
 *                  produce byte-identical results. CRDTs converge on
 *                  concurrent edits, but two *different* migrations of the
 *                  same document merge into nonsense. No timestamps, no random
 *                  ids, no iteration over an unordered map without sorting.
 *
 *   IDEMPOTENT     Running a migration on an already-migrated document must be
 *                  a no-op. A crash between migrating and persisting is
 *                  normal, and the retry must not double-apply.
 *
 *   FORWARD-ONLY   No down migrations. The same reasoning as ADR-0013: a down
 *                  migration is a fiction the moment one drops a field, and
 *                  maintaining the pretence costs effort for a path nobody can
 *                  safely take.
 *
 * A document written by a NEWER SONE than the one reading it is refused, not
 * guessed at. That is what makes an accidental downgrade fail loudly instead of
 * corrupting data.
 */

import * as Y from 'yjs';

import { DOC_KEYS, META_KEYS } from './docSchema.js';
import { SCHEMA_VERSION, type SchemaVersion } from '../types/ids.js';

export class DocumentVersionError extends Error {
  constructor(
    message: string,
    readonly code: 'too_new' | 'too_old' | 'migration_failed',
    readonly documentVersion: number,
    readonly supportedVersion: number = SCHEMA_VERSION,
  ) {
    super(message);
    this.name = 'DocumentVersionError';
  }
}

export interface DocumentMigration {
  /** Version this migration upgrades from. */
  from: SchemaVersion;
  /** Version it produces. Always `from + 1`; no skipping. */
  to: SchemaVersion;
  /** Human-readable reason, surfaced in logs. */
  description: string;
  /**
   * Mutate the document in place.
   *
   * Runs inside a Y.Doc transaction supplied by the caller, so all changes
   * land as one update. Must be deterministic and idempotent — see the notes
   * at the top of this file.
   */
  migrate: (doc: Y.Doc) => void;
}

/**
 * The migration chain.
 *
 * Append only, one step per version. Empty until the first format change,
 * which is the point: the machinery exists before it is needed, so the first
 * change is a normal release rather than a special event.
 *
 * When adding one:
 *   1. Append the migration here.
 *   2. Bump SCHEMA_VERSION in types/ids.ts.
 *   3. Add a fixture to the migration tests — a document at the old version
 *      and the expected result. Without a fixture the migration is untested
 *      forever after, since the old format stops being producible.
 */
export const DOCUMENT_MIGRATIONS: readonly DocumentMigration[] = [
  {
    from: 1,
    to: 2,
    description: 'the video block exists; a client that cannot draw one must not open documents',
    // Nothing to change. That looks odd and is deliberate (ADR-0039).
    //
    // `migrateDocument` refuses a gap in the chain, so the step has to exist —
    // and what it records is not a change of shape but a change of requirement.
    // A client whose schema predates a block type does not ignore that block: it
    // deletes it from the shared document, for everyone. So the version is what
    // lets the server refuse such a client at the handshake instead.
    migrate: () => {},
  },
  {
    from: 2,
    to: 3,
    description: 'a canvas page exists; a client that cannot draw one must not open it',
    // Nothing to change here either, and for a sharper reason than the last one.
    //
    // A canvas is a whole second document shape (ADR-0043): a page kind and a
    // root map of items, neither of which a client from before this release
    // knows. That client does not destroy a canvas — y-prosemirror never sees
    // the map — but it opens the page, finds an empty body, and offers somebody
    // a blank sheet where a drawing is. Writing into it would then produce a
    // page that is both, which nothing can resolve.
    //
    // The previous release also called itself version 2, which is exactly why
    // this step exists: "same version, different format" is the one thing the
    // handshake cannot catch, and the only way to fix it is to stop being the
    // same version.
    migrate: () => {},
  },
  {
    from: 3,
    to: 4,
    description: 'comments exist; a client that cannot show one must not delete the text it holds',
    // Nothing to change, and a sharper reason than the last two.
    //
    // A client from before this release does not destroy a thread — it never
    // touches the key. What it does is worse in a quieter way: it lets somebody
    // delete a paragraph that carries an unresolved comment, sees nothing, says
    // nothing, and leaves a detached thread quoting text that person never knew
    // was under discussion (ADR-0046).
    migrate: () => {},
  },
  { from: 4, to: 5, description: 'SOTE references are opaque task blocks; older clients must not discard them', migrate: () => {} },
];

/*
 * The shape of a real migration, kept as prose rather than as dead code:
 *
 *   {
 *     from: 2,
 *     to: 3,
 *     description: 'move block.props.level into block.props.headingLevel',
 *     migrate: (doc) => {
 *       const blocks = doc.getMap(DOC_KEYS.blocks);
 *       // Sort the keys: iteration order of a Y.Map is not guaranteed stable
 *       // across implementations, and a non-deterministic migration diverges.
 *       for (const id of [...blocks.keys()].sort()) { ... }
 *     },
 *   }
 */

/** Read the schema version recorded in a document. Defaults to 1. */
export function documentSchemaVersion(doc: Y.Doc): number {
  const raw = doc.getMap(DOC_KEYS.meta).get(META_KEYS.schemaVersion);
  return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : 1;
}

export interface MigrationOutcome {
  /** Version before, version after. */
  from: number;
  to: number;
  /** Migrations actually applied, in order. */
  applied: string[];
  /** True when the document was modified and must be persisted. */
  changed: boolean;
}

/**
 * Bring a document up to the current schema version.
 *
 * Returns without touching the document when it is already current, so the
 * caller can skip a write on the overwhelmingly common path.
 *
 * Throws `DocumentVersionError` with code `too_new` when the document was
 * written by a newer SONE. Refusing is the only safe option: applying an
 * unknown format's semantics would corrupt it, and silently ignoring the
 * version would make an accidental downgrade look like it worked.
 */
export function migrateDocument(
  doc: Y.Doc,
  origin: unknown = 'migration',
): MigrationOutcome {
  const from = documentSchemaVersion(doc);

  if (from > SCHEMA_VERSION) {
    throw new DocumentVersionError(
      `document is at schema version ${from} but this SONE supports ${SCHEMA_VERSION}. ` +
        `It was written by a newer version; upgrade rather than downgrade.`,
      'too_new',
      from,
    );
  }

  if (from === SCHEMA_VERSION) {
    return { from, to: from, applied: [], changed: false };
  }

  const chain: DocumentMigration[] = [];
  for (let version = from; version < SCHEMA_VERSION; version++) {
    const step = DOCUMENT_MIGRATIONS.find((m) => m.from === version);
    if (!step) {
      // A gap in the chain is a programming error, not a data problem: the
      // constant was bumped without a migration. Fail loudly rather than
      // leaving documents silently stuck at an old version.
      throw new DocumentVersionError(
        `no document migration from schema version ${version}; the chain is incomplete`,
        'migration_failed',
        from,
      );
    }
    chain.push(step);
  }

  const applied: string[] = [];
  // One transaction for the whole chain: the document must never be observable
  // in a half-migrated state, and one update is one append to the log.
  doc.transact(() => {
    for (const step of chain) {
      step.migrate(doc);
      applied.push(`${step.from}->${step.to}: ${step.description}`);
    }
    doc.getMap(DOC_KEYS.meta).set(META_KEYS.schemaVersion, SCHEMA_VERSION);
  }, origin);

  return { from, to: SCHEMA_VERSION, applied, changed: true };
}

/**
 * Can a client speaking `clientVersion` be served?
 *
 * A client older than the server would write documents in an old format that
 * the server has already migrated away from, and the merge would be
 * inconsistent. Such a client is refused with a clear reason rather than
 * allowed to corrupt documents.
 *
 * A client *newer* than the server is also refused: it would write a format
 * the server cannot project.
 */
export function isClientSchemaCompatible(clientVersion: number): boolean {
  return clientVersion === SCHEMA_VERSION;
}
