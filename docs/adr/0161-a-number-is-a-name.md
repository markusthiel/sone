# ADR-0161: A number is a name

## Status

Accepted. Built.

## Context

Noticed while writing ADR-0158, from a directory listing: `docs/adr` held two
files beginning `0155-` and two beginning `0039-`.

```
0039-client-schema-refusal.md      0155-the-document-that-is-not-there.md
0039-gallery-view.md               0155-the-first-minute-belongs-to-somebody.md
```

Four and a half thousand times in this tree, a comment or a record ends in a
bracketed number. That number is the whole of the citation — nobody writes the
slug — so a number claimed by two records answers a reader with *one of these
two, work out which*.

`check-adr-references.mjs` had been green through all of it. It reads the
directory into a **`Set`**, which is precisely where a duplicate goes to be
agreed with: the two files collapse into one entry, every citation resolves
against it, and the check reports ok. **The check was not wrong about anything it
was asked; it was asked the wrong question.**

## Decisions

### The later record moves, the earlier keeps its number

Because a number that has been cited is a name people have already used, and the
older record has been called that for longer. Where both arrived in the same
commit — the 0039 pair did — the tiebreak is which name is written down in more
places, so that the smaller set of citations moves.

| was | is now | why it moved |
|---|---|---|
| ADR-0155 *The document that is not there* | **ADR-0159** | arrived second, three days later |
| ADR-0039 *A gallery is a table drawn as covers* | **ADR-0160** | same commit as the schema refusal, six citations against eight |

Both moved records carry a line at the top saying what they used to be called.
Commit messages and pull requests from the weeks they were written cite the old
number and cannot be edited; a reader arriving from one has to land somewhere
that says *yes, this is the one you mean*.

Renumbering to the end rather than inserting: 0159 and 0160 were free, and every
other number stays where it is. Shifting a range to make room would move records
nobody had a problem with, and invalidate citations that were never ambiguous.

### And one citation was pointing at the wrong record

`styles.css`, above `.pdf-download`:

```css
/* The copy with the marks in it (ADR-0155). …
```

The copy with the marks in it is **ADR-0154**. The number was simply wrong — and
the collision is why it survived: `check-adr-references` confirms that a cited
record exists, and 0155 existed twice over, so a number that meant neither of
them passed. Corrected.

This is the argument for the whole round, in one line. An ambiguous name does not
merely fail to answer; **it makes wrong answers look like right ones**, because
the reader who lands on the wrong record has no way to tell.

### The check counts the records rather than deduplicating them

`groupByNumber` returns a `Map` of number → *list*. A number with more than one
name is refused, with both names printed.

**And it is proven against a fabricated listing before it is trusted**, in the
same script, because once this tree is clean the collision branch never runs
again — and a branch that never runs is a branch that quietly stops working
(ADR-0091). The proof costs four lines and one comparison.

## Consequences

Twenty-one citations moved: thirteen to 0159 — all of them the place-thread work
in `packages/web` — and six to 0160, the gallery, spread across `web`, `core`
and `server`. Two more in ADR-0156 and one changelog link. And one citation
corrected from 0155 to 0154.

Nothing about the behaviour of the application changed; this round touches
comments, one stylesheet comment, two filenames and a check.

### The check that could not have found this

Worth writing down plainly, because it is the second time this session that a
green check was green about the wrong thing (ADR-0157's test built a read-only
editor and then failed to write a link into it). The shape is the same both
times: **the reader agreed with itself.** A `Set` cannot report a duplicate, and
an empty document cannot fail to contain a bad link.

## Alternatives considered

**Leave the numbers and cite the slug as well.** Every one of four and a half
thousand citations would have to grow, and the next one written by hand would
not.

**An allowlist of the two known collisions.** A check with an exception written
into it is a check that gets a third exception. The two collisions are the only
ones, and they took an afternoon to remove.

**Renumber the *earlier* record in each pair**, so that neighbouring numbers stay
topically together — 0159 would sit beside the PDF rounds it belongs to, and
0039 beside the collection work. Tempting, and wrong: the number's job is to be a
stable name, not to sort. The record that has been called something for longer
keeps being called that.

**Insert and shift.** Numbers are names. Names do not shift.
