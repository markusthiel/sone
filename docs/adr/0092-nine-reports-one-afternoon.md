# ADR-0092: Nine reports, one afternoon

## Status

Accepted. Built. Nine faults reported in one message, three of them severe. This
records the two that were decisions and the seven that were mistakes, because
which is which is the useful part.

## Context

The reports, verbatim and grouped by what they turned out to be:

**A folder, shared, is not a page.** *"Der Ordner Video wird beim Gast als Seite
dargestellt auf die man schreiben kann, das ist ein grober Bug."*

**The guest comment feature ships unusable.** *"Wenn ich als Gast mit
Benutzernamen einen Kommentar setze kommt beim User nur Guest … Darauf habe ich
als User geantwortet und da kommt dann Jemand, der nicht mehr dabei ist."*

**A reply is not entered.** *"Ein Kommentar wird scheinbar eingetragen. Aber eine
Antwort auf einen Kommentar nicht."*

**The bell.** *"Beim Profilbild sehe ich eine 2 … Die Glocke sollte dann die Zahl
haben. Und die Zahl sowohl die Inhalte sollten sich live aktualisieren. Nicht
erst nach reload. Dort erscheint jetzt auch ein Eintrag den es wohl nicht mehr
gibt … Ich habe den Kommentar gelöscht … Der Eintrag bei der Glocke bleibt aber."*

**The shares screen.** *"Das Sharing Menü ist leer … Das ist noch nicht
durchdacht."*

**And two small ones.** The collapsible's counter overlapping its text from ten
upwards, and the shared tree drawing plain icons where the page draws real ones.

## The one that was worst, and was reported as the mildest

"A reply is not entered" is a `22P02`.

`notificationsFor` builds a reply candidate with `actorId: message.author`. A
comment's author is a user id **or** a `guest:` key (ADR-0046), and `actor_id`
is `uuid REFERENCES users (id)`. So the moment a visitor replied through a share
link, the INSERT tried `'guest:Lars'::uuid` and threw — **inside the
projection's transaction**. The whole rewrite rolled back: comment counts,
blocks, search row.

And the message stays in the document, so every later projection of that page
hit the same value and rolled back again. `isPermanentWriteFailure` counts
`23*`, `42*`, `3D*` and `3F*`; `22P02` is not among them, so the room retried
for ever rather than saying anything. A page that a guest replied on stopped
being projected, silently, permanently.

`textMentionsFor` guards exactly this, one function down, and was given the
guard three days ago (ADR-0091) after the same class of bug. `notificationsFor`
was not. That is now the **fourth** time in this codebase that a rule held in
two of three places, and the third time the third place was found by somebody
using the product rather than by a test.

## The decisions

### The badge belongs on the bell, and there is one of it

It sat on the account avatar — the only badge in the application, on a control
that opens a menu which does not hold the notifications. Moved to the inbox
icon, in both drawings, by putting the count **on the mode entry** rather than
passing it to each: there are two drawings (the rail and the mode bar) and a
number handed to one of them is a badge a phone does not have.

The count is now **counted from the list the inbox already holds**, not fetched.
It had its own `GET /api/inbox/count` inside `AccountMenu`, whose comment said
"once per mount, which is once per navigation" — routing here is `pushState`, so
that was once per *full page load*. Exactly "erst nach reload". Two sources also
meant the badge did not move when somebody marked something read.

Freshness is `focus` + `visibilitychange`, the pair `usePages` already uses. Not
a timer: a notification is wanted when somebody looks, and polling costs every
open tab. **The honest limit: a badge still does not appear while somebody is
staring at the page.** That needs a server push, the sync protocol has no frame
for it, and adding one is its own decision — named here rather than left as a
surprise.

### A notification whose thread is gone goes with it

The projection rewrites `page_comments` wholesale and `writeNotifications` only
ever inserts, so the two drifted one way for ever: delete a comment and its bell
entry stayed, pointing at a thread that is not there.

Deleted in the same transaction as the rewrite, guarded on `thread_id IS NOT
NULL` — an assignment and a text mention carry a null thread on purpose, and
without the guard every projection would wipe all of them. Threads, not
messages: the projection stores a thread per row and a count, so a single
deleted reply inside a surviving thread keeps its notification, which then lands
on the thread rather than the sentence. That is where the reader wanted to go.

### The shares screen is a menu and a list, like every other mode

Three lists stacked in the content column with an empty sidebar beside them —
the one arrangement this shell does not have (ADR-0069). Links, granted,
received become three views in the sidebar, counted from the list the screen
already holds. The order is unchanged and is still the advice: a link is the
only share that has already left the building.

### A guest's name may come with the request

The route refused it, reasoning that a request naming its own author can sign
somebody else's name. Right about a member, **empty about a guest**: the name on
a share session was typed into a box by the same person, over a different wire.
What stops a visitor signing as a colleague is the `guest:` prefix, which the
panel draws as a badge — not which transport the string arrived on.

And refusing it did not leave the name alone, it destroyed it. The share cookie
names the **link**, not the person holding it, so every HTTP request carrying it
resolved a session with no name — and the resolver substituted `'Guest'` **and
wrote it back over** the stored one. Posting a comment lost the name in the same
breath as signing with the wrong one.

Two further fixes fell out. A resolution with no name now *reads* the stored one
instead of replacing it. And an ordinary HTTP request is no longer a **visit**:
it was minting a `share_sessions` row per image and per comment, which inflated
the "active visitors" number in the sharing dialog by one per request.

## The mistakes

**A folder rendered as a page.** `ShareSession` rendered `PageView` for whatever
the link opened on. A folder has no body, so the visitor got the editor's empty
page with a caret in it and "Write something, or press / for blocks" — an
invitation to write into something that cannot hold writing, on a link that may
be read-only.

`FolderView` then had to learn to offer nothing: its name was an input and its
three buttons made things, unconditionally. Optional handlers rather than a
`canEdit` flag, so a caller with nothing to offer cannot pass one that refuses.

> **Related, and deliberately not fixed here.** A **member** with viewer rights
> on a folder gets the same input and the same three buttons in the workspace,
> because the page tree carries no per-entry role for the shell to ask. Giving
> it one is a route change and a wider decision than this report. Named so it is
> not discovered twice.

**The guest saw "somebody who is no longer here".** The authors list was
refetched when `threads.length` changed, and a **reply** does not change it. So
the commonest sequence of all went unnamed: a visitor opens a thread (no member
has written yet, the list is empty), a member answers, and the answer has no
name. Keyed on the message count now.

**The shared tree drew `icon={null}`.** Every entry got a plain folder or a
plain page while the title above the page showed the real one — the same entry
with two appearances on one screen. The route now sends the icon.

**The collapsible's counter.** The marker is absolutely positioned in a 1.4em
gutter and the count sits inside it, so two digits ran out over the first word:
"15Code Week". Only the document knows how wide the gutter must be, and only the
stylesheet can reserve space before layout — so the plugin puts the digit count
on the node and the stylesheet has a step per width, capped at three. A hundred
hidden blocks under one toggle is a toggle nobody opens.

## Consequences

**Nine reports, and eight of them are one sentence in the code.** The exception
is the shares screen, which was a design that had not been finished. Everything
else was a value used where a slightly different one was meant: a guest key
where a uuid was, a null icon where an icon was, a thread count where a message
count was, a fetch where a subscription was.

**Two of the three severe ones were reported as mild.** "A reply is not entered"
was a page that had stopped projecting. "Beim Gast steht Guest" was a resolver
destroying stored data on every request. The severity of a report says how it
*looked*, and the two are not related — which is the argument for reproducing
before fixing, every time, including when the fix seems obvious.

**A count is a second answer to a question a list already answers.** The badge
had its own request; so did the shares screen's headings, nearly. Both now count
what is in front of them. This is ADR-0086's rule in a smaller place, and it
keeps turning up because a number is so cheap to fetch separately.

## Alternatives considered

**Push notifications over the sync connection.** Would make the bell live in the
strong sense. It needs a new server frame and a NOTIFY channel keyed by user
rather than by document, and neither is small. `focus` covers the case that was
reported — coming back to the tab and seeing nothing new — and the residual gap
is named above rather than papered over.

**Let the badge keep its own count and just refresh it.** Two sources, refreshed
in two ways, disagreeing whenever one of them is updated optimistically. The
list is already there; counting it costs nothing.

**Delete a notification when its message goes, not just its thread.** The
projection has no row per message, so this would mean projecting messages to
find out. A thread is the unit the reader navigates to anyway.

**Give `FolderView` a `canEdit` boolean.** Reads the same and permits a caller
to pass handlers *and* false — which is a refusal waiting to be wired up.
Optional handlers make the type say it: nothing to offer, nothing to pass.
