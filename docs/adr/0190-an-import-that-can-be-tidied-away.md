# ADR-0190: An import that can be tidied away

## Status

Accepted. Built.

## Context

A whole workspace was exported from one instance and imported into another,
into a holding folder. The count matched — 73 pages out, 58 pages and 15
folders in. Then the top-level folders were moved out of the holding folder
to the root, the empty holding folder was trashed, and most of the pages two
or more levels down were gone. A second attempt, done in a different order,
kept everything. Nothing in the interface had said anything.

Separately, every folder and page arrived in the default look: the symbols
and colours somebody had chosen were not in the archive. The export's own
comment claimed a folder's index existed because "it has a name, an icon and
children" — and wrote the name.

## What happened

Archiving a folder takes its subtree with it, by `ancestor_ids`:

```sql
UPDATE pages SET archived_at = now()
 WHERE archived_at IS NULL AND (id = $1 OR $1 = ANY(ancestor_ids))
```

So the question is what `ancestor_ids` said after the move. The cascade that
rewrote them after a page changed parent looked each descendant's path up
from its parent's row, inside one UPDATE:

```sql
UPDATE pages p SET ancestor_ids = (
  SELECT parent.ancestor_ids || parent.id FROM pages parent
   WHERE parent.id = p.parent_page_id)
 WHERE p.id IN (SELECT id FROM subtree)
```

A statement sees the table as it was when the statement began. The moved
page's own row had been written a statement earlier, so its *children* read
the new path. Its *grandchildren* read their parent's row — unchanged in that
snapshot — and inherited the old path. Move `Projekte` out of `Import`, and
`Projekte/Messe` said `[Projekte]` while `Projekte/Messe/Spielemesse` still
said `[Import, Projekte, Messe]`. The tree, which hangs off `parent_page_id`,
looked right. Then `Import` was trashed, and every page whose stale path still
named it went with it.

The same stale path decided share-link scope, subtree grants and the folder
watch of the activity digest. It had been that way since `ancestor_ids` was
introduced; it needed a move of a folder with grandchildren followed by an
operation on the old ancestor to show, and an import into a holding folder is
exactly that sequence.

## Decision

**The cascade carries the path down the recursion.** The recursive CTE
starts from the moved page's own, already-written path and appends one id per
level; each row's new path is a value computed in the CTE, and the snapshot
no longer matters. Only rows whose path actually changes are written, so the
returned list — which the caller uses to tell clients what moved — is the
rows that moved.

A database test builds the four-level shape, moves the second level to the
root, and asserts the path at every level below; then trashes the holding
folder and asserts that only the holding folder is archived. It fails on the
previous cascade at the grandchild.

**The archive carries an entry's look.** Under the title heading, our export
writes one HTML comment — `<!-- sone-entry {"icon":…} -->` — holding the
page map's `icon` value, which is where the symbol, the symbol's colour and
the title's colour live. Markdown renderers drop the comment; the importer
reads it, validates it through the same `readEntryIcon` and `readTitleColor`
the icon route uses (so an archive cannot write a shape the interface would
not), and writes it into the new page's document. An entry with the default
look gets no comment at all. The same mechanism ADR-0189 chose for a
divider's shape, for the same reason: a fence would turn the whole page into
a code block in anyone else's reader.

## Consequences

Moving a folder is now safe to follow with anything that consults
`ancestor_ids`. Instances that already carry stale paths from earlier moves
keep them until the affected pages are next materialised; a rebuild of the
projection (`rebuild.ts`) recomputes every path and is the way to repair one.

Pages archived by the fault are in the trash of the workspace they were
imported into, not lost: restoring the holding folder restores what went with
it, and the pages can then be moved again — correctly this time.

Symbols and colours survive a round trip through an archive. The cover, the
width, the template flag and the lock do not yet; each is one more key in the
same comment, and none of them was asked for.

A canvas exports as an empty `.md` and imports as an empty page. That was so
before and is unchanged here; a canvas's items have no Markdown spelling, and
carrying them is a fence of their own, not a comment.

## Alternatives considered

**Cascade level by level in application code.** Correct, and one query per
level of depth. The CTE does it in one statement with the same bound (128) the
old one had, and the fix is a different SQL shape rather than a different
architecture.

**Archive by walking `parent_page_id` instead of trusting `ancestor_ids`.**
That would have hidden this fault rather than fixed it: share scope and grants
would still have been wrong, and the projection would still have lied.

**Frontmatter for the entry's look.** YAML frontmatter is what Obsidian and
most note tools write, and the importer could learn it. But frontmatter has no
agreed vocabulary for "which icon and what colour", so ours would be ours
either way; and a `---` block at the top of a file is *displayed* by renderers
that do not know frontmatter, where a comment is not. Reading other tools'
frontmatter for what it does say (tags, say) is a separate, worthwhile step.
