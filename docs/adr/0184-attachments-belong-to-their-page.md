# ADR-0184: An attachment belongs to its page, and an archive to its bytes

## Status

Accepted. Built. Three findings from the external review of `main` at
`8056a44` — F04, F07, F08 — kept together because they are the same sentence
about files: a file is authorised through the page it hangs on, and its size is
what it actually is, not what it says it is.

## Context

`files/routes.ts` already states the rule the other two paths broke: "Authorised
through the page it hangs on, so a file in a page nobody may see is a file nobody
may fetch." The direct download honours it. The export and the variant upload
did not, and the ZIP importer trusted a number an attacker writes.

### F07 — the export loaded files by id, not by page

The export gathers the file ids referenced in each exported page's blocks and
loads them with `WHERE workspace_id = $1 AND id = ANY(...)`. No check that the
file's own page is one the asker may read. An editor of page A who knew a file id
on the restricted page B — the id is in the Yjs document A synced, or was, before
a restriction was added — could paste it into a block on A and pull B's bytes out
through the export. The direct download would have refused the same file.

### F08 — a variant could be pinned to somebody else's original

An image's web-sized copy points at its original by `variantOf` (ADR-0029). The
upload checked only that the original was in the same workspace, not on the same
page. So an editor of page A could upload a variant pointed at an original on
page B, and `GET /api/files/<B's original>` would then serve A's bytes to B's
readers — a page A cannot write. The retrieval side made it worse: it picked the
web variant with `LIMIT 1` and no `ORDER BY`, so with more than one the served
copy was whatever the heap returned.

### F04 — the ZIP importer trusted the declared size

The 512 MiB import limit summed the *uncompressed* sizes declared in the ZIP
central directory, before inflating anything. A zip bomb declares a small size —
zero, even — and inflates to gigabytes, and `inflateRawSync` was called with no
output bound, so the declared number was the only thing standing between an
import and the process's memory. On Node 22 there is no implicit ceiling; a
few-megabyte upload could inflate to more than the machine had.

## Decisions

**F07 — authorise each attachment through its own page.** The files query now
joins `pages` and applies `visiblePagesCondition` — the exact test the tree, the
search and the direct download use. A file counts toward the archive only if its
own page is one this viewer may see. This deliberately keeps a legitimate case
the stricter "must be one of the exported pages" rule would have dropped: an
image copied into page A from another page the viewer *can* read is still
included, because that page passes the same visibility test.

**F08 — bind original and variant to the same page.** The upload requires the
original to be on the page the variant is uploaded to (`AND page_id = $3`), so
the write access already checked for that page is the access to the original. The
retrieval only chooses a variant whose `page_id` matches the original's, oldest
first (`ORDER BY v.created_at, v.id`), so an already-smuggled variant is inert
and the choice is deterministic. The client only ever makes a variant on the
page it just uploaded the original to, so no real case is lost.

**F04 — bound the actual output.** `inflateRawSync` is called with
`maxOutputLength` set to what is left of the 512 MiB budget, so zlib throws the
moment it would exceed it rather than allocating the bomb first. After inflate,
an entry whose real length does not equal its declared size is refused, and the
budget is charged the *actual* length. The declared-size check is kept as a
cheap early "no" for an honest large archive, but it is no longer the thing that
protects memory.

## Consequences

The three file paths now agree: a file is reachable exactly through the page it
hangs on, whether it is downloaded, exported, or resolved as a variant; and an
import is bounded by the bytes it really produces. Nothing changes for the
ordinary cases — a page's own images export and download as before, a variant on
its own page is served as before, an honest archive imports as before.

Each fix gained the test that fails on the old code:

- `failsClosed.db.test.ts` references a restricted page's file id from an
  ordinary page and exports as a member who cannot read the restricted page,
  asserting the archive carries no attachment and the store is never asked for
  the restricted file's bytes.
- `files.db.test.ts` uploads a variant pointed at an original on another page
  (refused, 422) and one on the same page (accepted, 201);
  `imageVariants.db.test.ts`'s query copy gains the page clause and a case where
  a foreign-page variant is not chosen.
- `unzip.test.ts` patches an honest archive's declared size to zero and asserts
  the reader refuses on the real bytes rather than accepting a megabyte.

## Alternatives considered

**Export: restrict attachments to the exported page set.** Simpler
(`page_id = ANY(exported ids)`), but it drops an image legitimately copied in
from another readable page. Authorising through the page — the same rule as the
download — is both correct and looser in the right direction.

**F08: generate variants on the server.** The clean long-term answer (the client
would never name an original at all), but a larger change to the upload path.
The same-page check closes the hole without it, and the two are compatible.

**F04: move the import to a worker thread.** Would also stop it blocking the
event loop for the duration of a large inflate, and is worth doing — but it is a
bigger change, and the memory exhaustion is the sharper risk. The output bound
is the fix; the worker is a follow-up, noted here rather than built.
