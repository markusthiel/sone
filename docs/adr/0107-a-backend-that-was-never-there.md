# ADR-0107: A backend that was never there

## Status

Accepted. Built. Found while starting on the *file* orphan sweep — the next item
on `claude/durchgang-nie-gelaufen.md` — by asking where the files actually are.

## Context

`SONE_STORAGE_BACKEND` accepted `local` or `s3`. Choosing `s3` made `loadConfig`
**require** `SONE_S3_ENDPOINT`, `SONE_S3_BUCKET`, `SONE_S3_ACCESS_KEY_ID` and
`SONE_S3_SECRET_ACCESS_KEY`, validate `SONE_S3_REGION` and
`SONE_S3_FORCE_PATH_STYLE`, and return a `storage` object holding all six.
`.env.example` listed them. `docker-compose.yml` forwarded them, and its comment
called them "the whole of the S3 backend". `docs/deployment.md` told operators
what to do about them.

There is no S3 backend. `store.ts` says so, honestly, in its own header — *"the
interface is deliberately small so an S3 backend can implement it later"* — and
`main.ts` built the same store either way:

```ts
const fileStore = new LocalFileStore(
  config.storage.backend === 'local' ? config.storage.path : '/var/lib/sone/files',
);
```

A wasted setting would be a small thing. This one is not, because **the backup
reads the same flag**:

```js
filesPath: config.storage.backend === 'local' ? config.storage.path : null,
```

## What that composes into

1. The operator sets `SONE_STORAGE_BACKEND=s3` and four credentials. Every one
   is accepted, and two of them are *required* — the strongest possible
   statement that a feature exists.
2. Uploads go to `/var/lib/sone/files`, on the container's volume. The database
   is honest about it: `files.storage` records `deps.store.kind`, which is
   `'local'`.
3. `backup.mjs` passes no files path, so the archive holds the database and
   **none of the attachments**, and the manifest records `fileStorage: 's3'`.
4. `docs/deployment.md`: *"an instance with `SONE_S3_*` set has a database backup
   and a bucket, and the bucket needs a backup of its own."*
5. So they back up a bucket that has never had a byte written to it.
6. And when they restore, the archive tells them: *"the source kept attachments
   in S3, so they are not in this archive: point this instance at that bucket."*

Every step is locally reasonable. Together they lose the attachments of anybody
who followed the documentation, and then send them looking for a bucket instead
of the volume where the files still are.

The restore's message is the sharpest part. ADR-0079 improved it: the old text
was *"archive contains no files. If the source used S3 storage…"*, addressed to
everybody and accurate for one of them, and it was replaced by a message that
says which case it is — decided from `filesPath: null`, which "means S3". It
never meant S3. **Precision about the wrong thing is worse than the vagueness it
replaced**, because it is confident and actionable, and it costs whoever reads it
the hour in which the old volume might still be mounted somewhere.

## Decisions

### The config refuses `s3`, and that is where it must happen

Not at the point the store is built. The config is where the belief came from:
it demanded four settings and accepted them. Refusing there also stops
`backup.mjs` and `restore.mjs`, which call `loadConfig` too — the whole family,
in one place.

`'s3'` stays in the accepted list so the refusal can be specific. An unknown
value gets "must be one of local, s3", which is a nonsensical thing to say to
somebody who set `s3` on purpose.

### The refusal says where the files are

Whoever hits this has a running instance. Their uploads are on local disk at the
default path, the fix is one variable, and nothing moves. A refusal that omits
that reads as *"your files are gone"*, which is the opposite of true and the
moment somebody does something drastic.

It also tells them to check their backups, because the archives taken while the
setting was on are the real loss and nothing else will mention it.

### The type collapses

`Config['storage']` is `{ backend: 'local'; path: string }`. `BackupOptions` and
`RestoreOptions` take `filesPath: string` rather than `string | null` — `null`
meant "this instance uses S3", and leaving it alive leaves the producer of
`fileStorage: 's3'` alive with it.

A type is not documentation of intent, it is a claim about what exists. That
claim is what made this survivable for as long as it was.

### A legacy archive is told the truth

Archives written before this build carry `fileStorage: 's3'`. Nothing produces
that any more, so the test has to forge one — and the restore now says: this
build never implemented S3, the source's attachments were on its own disk, and
this archive does not contain them; copy that directory across if the source
still exists. No bucket is mentioned, because there is none to mention.

## Consequences

**Nine tests, four failing before the change**, plus one existing test whose
assertion was rewritten: it asserted the *old* S3 wording, and asserting it was
what kept the wrong message correct-looking.

**Six settings leave `.env.example` and `docker-compose.yml`**, and
`check-env-reaches-container.mjs` — which derives its list from string literals
in `config.ts` — now finds 21 variables instead of 27 and still passes. That
check was written after fourteen variables failed to reach the container; it
was, ironically, forwarding six that reached a backend that did not exist.

**This displaces the file orphan sweep, which is still open**, and it is better
found first: a sweep would have been built against a storage abstraction whose
S3 half is fiction, and the first question it has to answer is which files
exist. That question now has one answer instead of two.

**Nothing has to move for any operator.** The files were always where they are
now. What changes is that the instance says so.

## Alternatives considered

**Implement the S3 backend.** The honest completion, and a large one: a
dependency, a credential path, a list operation, and no way to test it in CI
without a live endpoint. It also does not help anybody whose archive is already
missing its attachments, which is the urgent half.

**Fall back to local with a loud warning.** A warning at startup is read once, by
somebody who is watching the logs of a deployment that appeared to work. The
failure it prevents surfaces at restore time, months later, and the operator's
own backup procedure hides it in between.

**Keep accepting `s3` and fix only the backup path**, so the archive contains the
files. It makes the archive correct and leaves an instance that reports a
storage backend it does not have, six settings that configure nothing, and a
`files.storage` column disagreeing with the configuration.

**Drop `'s3'` from the accepted values entirely**, so it fails as an unknown
value. One line shorter, and the message becomes "must be one of local" — which
tells somebody who deliberately configured a bucket nothing about what happened
to their files.
