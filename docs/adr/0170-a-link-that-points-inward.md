# ADR-0170: A link that points inward

## Status

Accepted. Built. The first of three rounds on cross-references.

## Context

Asked for as a gap in the whole system rather than a fault in one screen:

> Was derzeit im System noch ganz fehlt sind Querverweise und interne Links.
> Eine Seite mit einer anderen Seite verlinken wäre super. Aber auch einen
> Inhalt mit einem anderen Inhalt eventuell aus einer ganz anderen Seite
> verlinken wäre gut. Ich setze einen Link und anstatt auf eine externe Website
> ist es ein interner Anker. Ich stelle es mir so vor, dass man dazu bei einem
> vorhandenen Content Element auf dem Anfasser einen Button hat mit "Interne URL
> kopieren".

Measured before designing anything, and **the anchor already existed**. Every
block carries a persisted uuid (`blockIds.ts`, in the CRDT, surviving moves and
reloads). `paths.page()` has taken a block id since ADR-0033. `blockFromHash`
reads it back. `PageView` scrolls to it on arrival, retrying while the document
syncs. `showAsFound` lights it (ADR-0166, ADR-0167). The schema's own comment on
`data-block-id` says what it is for: *"so a drag handle, a node view or **a link
target** can find a block in the DOM"*.

What was missing was not the anchor. It was **the way there** — and three faults
sat on that way, each of which makes a correct link do nothing.

## Decisions

### What is stored carries no credential

`usePageLink()` puts the share token into every URL it builds, and ADR-0113 is
about why: a visitor navigating a shared document who loses their token hits a
login wall mid-page.

That is right for a link being **followed**. It is wrong for a link being
**stored**. A token written into a page is a credential that travels with the
page — copied into the next share, carried into an export, read by everybody the
page is later shown to.

So `blockAddress()` is deliberately **not a hook and reads no context**: there
is nothing for a token to arrive through, which is a stronger guarantee than
remembering not to pass one. It lives in `routes/`, because that is where
`check-page-links.mjs` allows `paths.page(` to be called at all.

### And the credential is put back on at the click

The stored link says `/p/…`, so a share visitor following it would land exactly
where ADR-0113 said nobody should. `internalTarget()` re-applies the token at
the moment of the click, taken **from the address bar** rather than from the
document.

**The token belongs to the reader, not to what is being read.** A member has
none and gets the address unchanged; a visitor gets `/s/<token>/p/…`; and a
visitor following a link to a page outside the share still meets a wall, which
is correct — the link points somewhere they were not given.

Only the page space is rewritten. `/settings`, `/search`, `/admin` exist once,
and prefixing one would invent a URL that has never existed.

### The fragment survives the click

`useLinkInterception` navigated to `pathname + search`. The fragment — which is
the entire block half of an internal link — was dropped on every in-app click.
A link would land on the right page and never on the right block, which to
whoever wrote it looks like a link that does not work.

### A comment that described what the dependency list could not do

`PageView`'s arrival effect read `window.location.hash` with `[pageId]` as its
dependencies, under this note:

> Per page: following a second result from the same search has to scroll again,
> and the hash is what changed.

The hash is what changed, and the dependency list cannot see it. So **following
a second search result on the same page has never scrolled** — a latent fault
older than this round, and the ordinary case for the feature being asked for
here, because linking one passage to another usually means a passage on the page
you are already reading.

The fragment is state now (`useLocationHash`), and it is in the list.

`history.pushState` fires nothing at all — not `hashchange`, not `popstate` — so
`navigate` announces `sone:navigated`. A named window event with several
listeners, the arrangement `sone:found-block` and `sone:open-thread` already use:
each listener holds exactly the state it holds anyway. Its own hook rather than
a value threaded down, because the component that needs it is rendered by two
shells and neither has any other reason to know about fragments — and calling
`useRoute` twice would be two independent copies of the route.

### The button says what it does, not how

*„Link zu diesem Block kopieren"*, not *„Interne URL kopieren"*: what somebody
wants is a link to **this**, and "internal" describes the implementation rather
than the act.

It sits below the icon row rather than in it. Every item in that row is a
`Command` the editor can refuse, and this one changes nothing about the
document; a row whose members are all one kind of thing is a row somebody can
reason about. **The menu stays open**, unlike everything else in it, so the
label has somewhere to say *copied* — a confirmation on a menu that has already
closed is a confirmation nobody sees.

### A link home does not open a second application

Every row in the links panel was `target="_blank"`. Right for a link out; wrong
for one that points back here, where a new tab means a second sync connection, a
second copy of the document, and losing the place you were reading — for what a
click was supposed to do in this window.

## Consequences

**Thirteen tests**, and the shape of them is the point: the two decisions with a
security edge are made in two exported functions that take their world as
arguments — an origin and a token — so *what goes into a document* and *what
happens on a click* can each be stated in a line with no browser present. One of
them asserts against the module's own source that it names neither
`sharePage` nor the share context at all.

**One test changed.** `paths.test.ts` pinned `blockFromHash(window.location.hash)`
and was right about it; what neither it nor the comment beside the effect could
see was the dependency list underneath. It now pins the fragment being read as
state, with a note saying what the old assertion could not have caught.

**A prop threaded twice** — the page's title, from `PageView` through
`EditorSurface` to `BlockMenu`, for a slug that is decorative and always was.

## Alternatives considered

**Store the URL `usePageLink()` builds.** One function, and it writes share
tokens into documents.

**A new mark or node with `pageId`/`blockId` attributes.** The title could then
be looked up live and would follow renames. Rejected for this round: it is a
schema change, and an internal link stops being a link the moment it leaves
SONE — an export, a copy into an email, a paste into a chat. A relative address
is a real address everywhere, and the page uuid inside it is what a backlink
index will read in round three. The stale-label cost is the one the `mention`
node already accepts out loud: *"that is a copy and it goes stale, and it is
still right."*

**Resolve internal links in the editor rather than in the router.** Then a link
in a comment, in a panel, in a properties field would each need the same
resolution again. The interception is one place and already exists.

**A `sone:` scheme instead of a path.** Unambiguous, and unfollowable by
anything that is not this application — including the address bar, which is
where somebody pastes a link they were sent.
