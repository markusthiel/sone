# ADR-0079: A backup that says what it is

## Status

Accepted. Second of the audits argued for by ADR-0076 and ADR-0077; amends
ADR-0044.

## Context

Backup and restore is better covered than the mail path was — there is a real
round trip in `upgrade.db.test.ts` that dumps a database, drops the schema,
restores it and reopens the Yjs documents. ADR-0013 makes upgrades forward-only,
which is only defensible if that path works, and it does.

What the audit found is a different shape of problem from ADR-0078's. Nothing
here is unrunnable. The faults are all one thing said differently: **the backup
knew something and did not write it down**, and the restore then had to guess,
or the operator did.

**One claim I was given was false, and checking it is the point.** The audit
reported that `pg_restore` without `--exit-on-error` carries on past errors and
still exits 0 — which would mean a restore that dropped half a database could
report success. It does not. Against pg_restore 16, a restore that ignored three
errors printed `warning: errors ignored on restore: 3` and exited **1**, so
`run()` has always rejected. I checked before changing anything, because
ADR-0077 is four days old and its subject is exactly this: believing a confident
description of a mechanism instead of running it.

The real faults:

**`files: null` meant three different things.** The instance keeps attachments
in S3; the directory was empty; or nobody could look at the directory. The
restore could not tell them apart, so it told every operator with a file-less
archive to "point this instance at the same bucket" — advice that sends somebody
who has never had a bucket looking for a configuration that does not exist.

**A file directory that could not be read produced a cheerful backup without the
files in it.** `stat(...).catch(() => null)` makes a volume that failed to mount
indistinguishable from an empty one. The backup logged "not present, skipping"
and exited 0. A backup is allowed to omit things; it is not allowed to omit them
by accident.

**An S3 instance's backup was database-only, quietly.** One line of log among
several, no field in the manifest, no warning. The bucket is a backup problem of
its own, and the moment to say so is while the backup is being taken.

**A backup interrupted before its manifest left something shaped like an
archive.** The manifest is written last, which is right; the directory carried
its final name from the first byte, which is not. The restore then failed with a
raw `ENOENT` naming a JSON file — a puzzle at the worst possible moment.

**A restore that failed left a database halfway between two states.** Not
silently, as reported, but partially: `pg_restore` drops and recreates as it
goes, so a failure two-thirds through leaves a database nothing describes, on a
day somebody is already having a bad one.

**The refusal message promised something the code does not do.** "…or pass
`--force` to drop and recreate the public schema." `--force` skips the emptiness
check and nothing else. Restoring an older dump over a newer schema therefore
leaves the newer tables in place while `schema_migrations` is rewound — which is
precisely the state that makes the next start fail on a column that already
exists, the failure this repository already has a regression test for.

**`sha256File` read the whole artefact into memory.** Above Node's two-gigabyte
buffer limit that throws: the backup of the instance big enough to need one is
the backup that cannot be made. Below it, it asks a container for as much RAM as
the database is large — at both ends, and the restore end runs on the bad day.

**`psql_failed` was unreachable and `pg_dump_failed` was wrong.** `psql` is never
spawned, so every `pg_restore` failure was reported under a code naming the
other half of the file, and a missing `tar` was reported as "Is the
postgresql-client package installed in the image?".

And two documents describing things that are not there. `README.md` showed the
backup and restore commands in one block, both as `docker compose exec app`,
while the warning that a restore must not run under a live instance sat in a
script docstring an operator will never read. ADR-0044 describes an
Administration entry documenting what a backup is, linking to the deployment
guide, and reporting whether the file store is on disk or S3 — a screen that was
never built. The whole web package contains one occurrence of the word "backup",
in an unrelated warning about OIDC secrets.

## Decision

**The manifest records why there are no files.** `fileStorage: 'local' | 's3' |
'none'`, optional so an older archive still restores, and the restore's warning
says the true thing for each case.

**An unreadable file directory refuses the backup.** ENOENT is "there is
nothing"; anything else is "I cannot look", and the second one is not a backup.

**S3 is announced while it happens**, as a warning naming what is missing and
whose problem the bucket is.

**An archive is a directory with a manifest in it.** The backup is built as
`sone-<stamp>.incomplete` and renamed when the manifest lands, so an interrupted
one is visibly not a backup, and the restore says which of the two it is met.

**`pg_restore --single-transaction`.** The restore happens or it does not, and
if it does not, the previous state is still there. It implies
`--exit-on-error` and rules out `--jobs`, which this has never used.

**The messages say what the code does.** The `--force` explanation says it skips
a check and does not empty anything, and says what happens if you use it to go
backwards. `sha256File` streams. The error codes name the command that ran.

**The documents are corrected**: a restore section in `docs/deployment.md` that
begins with stopping the application and names the three things a restore does
not do — migrations, `--force`, and secrets — and a README that no longer prints
the two commands as though they were the same kind of thing. ADR-0044 carries a
correction note rather than a rewrite: the reasoning there stands, the
description does not, and a reader deserves to know which sentences were a plan.

## Consequences

`SONE_SECRET_KEY` remains outside the archive and remains the sharpest edge
here. Restoring with a different key succeeds and then fails to read anything
sealed with the old one — second factors and share links stop working, one
account at a time, with no error anywhere. The deployment guide now says so. A
fingerprint of the key in the manifest would let the restore refuse, and that is
worth doing; it is a decision about what a manifest may contain and belongs in
its own record rather than at the end of this one.

Five tests were added and one was corrected. The corrected one asserted the
*wording* of a warning rather than its meaning, which is why it had to change at
all — the intent it was written for is unchanged and is now checked instead. One
of the new ones taught me something about the harness: the obvious way to test
an unreadable directory is `chmod 000`, which passes only where the suite is not
running as root, and CI runs it as root. It uses `ENOTDIR` instead.

The audit's own report was wrong about the most serious thing in it, and right
about seven smaller ones. That is a good ratio and a bad reason to relax: the one
it got wrong is the one that would have had me add a flag to fix a bug that did
not exist, and then write a record explaining a repair to nothing. Every claim
about what a program does is a claim to be run, including the ones that arrive
from a careful reader.

Still unexercised in this area, named rather than fixed: `scripts/backup.mjs`
and `scripts/restore.mjs` themselves — argument parsing, `--force`, exit codes —
which nothing imports; and the pg_dump version-mismatch test, which `return`s
rather than skipping when no older client is installed, so it reports green on
any machine without postgresql-client 14 or 15, including CI.
