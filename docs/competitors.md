# Where SONE stands, September 2026

A deliberate look at what comparable tools do that SONE does not. Dated, because
every line of it will be wrong within a year, and written as a record rather than
a plan: the ordering at the end is an argument, not a schedule.

## Method, and its limits

Read in September 2026: Docmost's own changelog and documentation, Outline's
feature page, AFFiNE's and Anytype's comparison material, and two 2026 round-ups
of self-hosted wikis. Marketing pages overstate; a feature named on a roadmap is
not a feature anybody has used. Where a claim came only from a vendor's own page
it is marked *(claimed)*.

What is *not* in this review: how good any of these things are. "Docmost has
comments" says nothing about whether its comments are pleasant. The gaps below
are gaps in capability, and closing one badly is worse than leaving it open.

## The field

| | What it is | Where it is ahead of us |
|---|---|---|
| **Docmost** | AGPL team wiki, Node + Postgres, ~21k stars | Comments, page history, templates, diagrams, math, DOCX/PDF/Confluence import, DOCX export, API, synced blocks |
| **Outline** | Team knowledge base, polished, 20 languages | Comments, history, search quality, integrations, public publishing, API maturity |
| **AFFiNE** | "Notion + Miro", local-first, TS + Rust | Doc↔canvas as one surface, frames exported as slides, offline-complete, desktop and mobile apps |
| **Anytype** | Object-based, P2P, local-first | Offline-complete, object types and relations, graph view |
| **AppFlowy** | Rust + Flutter Notion clone | Native performance, desktop and mobile apps |
| **Notion** | The reference everyone is measured against | Databases with relations and rollups, calendar, templates, API, ecosystem |

Two things worth noting because they are *our* advantages and easy to forget.
Docmost puts SSO and page-level permissions behind a paid tier; SONE has OIDC and
per-page permissions in the AGPL core. AFFiNE's self-hosted build is reported to
cap at three users unless connected to their cloud *(claimed by a third-party
round-up, not by AFFiNE)* — if true, that is the whole self-hosting proposition
undermined, and SONE has no such limit.

## What we have that holds up

Full-text search with ranking and snippets, real-time collaborative editing on a
CRDT, nested pages with drag-and-drop,
per-page permissions and groups, OIDC, share links with roles and passwords,
collections with table/board/gallery views and filters, a trash with a retention
window, multiple and personal workspaces, files with byte-range serving and
browser-side resizing, a three-layer design system with light and dark parity, a
compile-time-checked translation catalogue with German including du/Sie, and a
canvas with strokes, shapes, pictures, per-person undo and endless panning.

The canvas is the piece that puts us in AFFiNE's category rather than Docmost's,
and it is two weeks old. That is worth remembering when reading the list below:
the gaps are mostly in the *wiki* half, which is the older half.

## Gaps, ordered by what I would do next

### 1. Comments

Every wiki-shaped competitor has them; we have none. Docmost and Outline both
have inline threads with resolve. This is the single largest gap for anything
more than one person, and it is not a feature that can be added late — a comment
anchors to a range of text, and the anchor has to survive other people editing
around it, which is a CRDT question and therefore an architectural one.

Needs an ADR before code. The hard part is not the panel.

**Built** — [ADR-0046](adr/0046-comments.md). Anchored by a pair of Yjs relative
positions; a thread whose text has been deleted is *detached* rather than
dropped. Still to come: the Postgres projection (so unresolved threads can be
found across a workspace), mentions, an inbox, and a comment-only role.

### 2. Page history you can look at

We have a complete history already — every document is a Yjs log, which is
strictly more than a list of versions. What we do not have is any way to *see*
it. Docmost and Outline both offer "restore this version", and it is one of the
first things anybody asks of a wiki after they lose a paragraph.

**Corrected, and decided in [ADR-0047](adr/0047-page-history.md).** The claim
above that "the data exists" is wrong, which I found only when writing the
record: `compactDoc` folds the updates into one state and *deletes* the ones it
folded in (ADR-0002, deliberately). The log therefore reaches back to the last
compaction and no further, so history has to be kept on purpose rather than
derived — versions taken when a sitting ends and, as a guarantee, before
compaction runs. Restoring applies the old state forward as a new edit, because a
CRDT cannot be rewound. **Built.**

### 3. Templates

Already named in an earlier session as "the real need" behind wanting to copy
pages between workspaces. Docmost shipped them in July. A page you start from a
shape is the difference between a wiki people fill in and one they abandon.

Small, well understood, no architecture at risk. The cheapest large win here.

**Built** — [ADR-0045](adr/0045-templates.md). A template is an ordinary page with
a flag, which meant it came out working for canvases too.

### 4. Export and import

Export: Markdown, PDF, and a whole workspace as an archive. Import: Markdown,
DOCX, and Notion or Confluence for people arriving from somewhere else.

Decided in [ADR-0044](adr/0044-import-export.md), not yet built — including the
part that turned out to be the real prerequisite: an export of a whole workspace
is a background job, and this server has a maintenance timer rather than a job
runner.

**Export is built for a page and its subtree** (Markdown plus attachments, one
archive). Still to come: the whole workspace, which needs the job runner, and
import.

Export is an ownership question, not a convenience: a self-hosted tool that
cannot hand back its contents in an open format is asking for the same trust the
hosted ones ask for. That argument is ours to make and we currently cannot.
Import decides whether anybody can *start*.

### 5. Links that go both ways, and mentions

We collect links in a panel. We do not show what links *to* a page, and there is
no `@` for a person or a page. Backlinks are what turns a set of pages into a
body of knowledge; mentions are what makes a comment reach somebody, so this and
comments arrive together whether we plan it or not.

### 6. Search filters, and typo tolerance in the body

I nearly wrote "the body search is thin" here and then read the query. It is
not: body text is a ranked `tsvector` search using both a stemmed and a simple
configuration, with `ts_headline` snippets and the workspace's own dictionary. It
is better than I remembered and better than the round-ups credit most tools with.

What is actually missing is narrower. There is no way to filter results by tag,
author or date — the search screen separates folders from pages and nothing else.
And typo tolerance is titles-only: trigrams cover names, so a misspelt word in
the body finds nothing where a misspelt title still finds the page.

Both are small. Left at this position rather than moved up because searching
works today; it just cannot be narrowed.

### 7. Maths and diagrams inside a page

KaTeX for equations, Mermaid for diagrams from text. Docmost has both. Our canvas
answers a different need — a drawing beside the text is not a drawing *in* the
text — and a Mermaid block is a small, self-contained node type.

### 8. Relations, rollups and formulas in collections

Named as open for several sessions. This is what makes a collection a database
rather than a table, and it is the largest piece of work on this list. Notion's
lead here is real and not closeable in one pass.

### 9. Date properties and a calendar view

Already on the user's own roadmap page. Needs 8 first: a calendar is a view over
a date property, and a date property is a property type.

### 10. An API

Docmost shipped read/write for pages, spaces and members in March. Ours would be
straightforward — the HTTP layer already exists and is coherent — and it is what
lets somebody automate around us instead of asking us for a feature.

### 11. Offline

Local-first is the flag AFFiNE, Anytype and AppFlowy all plant. We persist to the
browser and reconnect, which is most of the way to editing on a train, but
"works fully offline" is a claim we have not tested and should not make until we
have.

## What I would not copy

**An AI copilot, yet.** Every competitor shipped one in 2026 and it is the
loudest item on all their roadmaps. It is also the feature most likely to be
built on somebody else's API, to date badly, and to distract from comments and
history — which people ask for by name. A summarise button in a wiki that cannot
show you last Tuesday's version is the wrong order of work.

**Synced blocks.** Docmost has them and they are genuinely useful, but a block
that exists in several pages at once contradicts "one document, one log" fairly
deeply. Templates and transclusion-by-link get most of the value without it.

**A peer-to-peer model.** Anytype's is impressive and it is a different product.
Ours is a server somebody runs, and that is a feature.

**Native desktop and mobile apps.** Three competitors have them and they are
mostly a distribution strategy. The web app being genuinely good on a phone —
which recent work has been about — is worth more than a shell around it.

## The honest summary

Against Docmost and Outline we are behind on the boring, expected parts of a
wiki: comments, history, templates, export. Against AFFiNE and Anytype we are
behind on offline and ahead on permissions and multi-tenancy. Against Notion we
are behind on databases and will be for a long time.

What we have that none of them quite have: per-page permissions and SSO in the
open core, a canvas and a document under one permission and sharing model, and a
German-first interface that treats du and Sie as a real setting rather than a
translation accident.

Four items — comments, visible history, templates, export — would put us level
with the best self-hosted wiki on the parts people actually name. None of them
needs a new architecture. Two of them need an ADR first.
