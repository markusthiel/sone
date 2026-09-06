# ADR-0119: Five things from one session

## Status

Accepted. Built. Reported from use. Supersedes the "by address rather than from
a list" half of ADR-0073.

## Context

Five reports in one message, and they sort into three kinds: two settings that
are in the wrong shape, one screen that is hard to read, and two things that are
only wrong on a phone. Each is recorded below with what it actually was.

---

## 1. Adding somebody was an address field, and gave no confirmation

> Das wäre sinnvoller wenn man ein Suchfeld mit Dropdown hätte. […] Nur beim
> Eingeben der Email ist es nicht intuitiv ob es auch wirklich geklappt hat und
> ob es die richtige Person ist.

**ADR-0073 decided the opposite, and gave a reason:**

> By address rather than from a list of everybody. An owner adding a colleague
> knows their address; a picker of every account on the server would turn every
> workspace owner into a reader of the instance's directory, which is a right
> the administration keeps on purpose (ADR-0032).

The concern is right. The conclusion was too strong, and the evidence is twenty
lines below it in the same file — the adding route, on an address with no
account:

> Said plainly rather than hidden. […] the people who can ask this question are
> the ones already trusted with who is in the workspace.

So **address → account was never protected from this caller.** They could
confirm any address, one request at a time, and the field's only real effect was
to make the honest case — *is this the right person?* — impossible to answer
before pressing the button.

### What is built

`GET /api/workspaces/:id/people?q=`, taking the same `people.manage` right the
adding route takes, matching **name or address**, returning up to eight rows
carrying both.

**Nothing without two characters.** That is the whole difference between
confirming a person and listing the instance: with no query there are no
results, so this is never a directory being read. The honest limit of that claim
is that a determined caller could walk prefixes; what it buys is that the
directory is awkward rather than open, and the caller could already enumerate by
address anyway. What is genuinely new is **name → address**, which is why this
takes the same right and not a looser one.

**Somebody already here is returned and marked**, not filtered out. Hidden, they
read as "no such person" — the same confusion this change is fixing, arriving
from the other side. `already_member` is what the adding route says; this is
that answer moved to before the click.

---

## 2. The roles screen was four things on one line

> Das könnte optisch aufgeräumter sein. Man kann pro Rolle gerne eine Karte
> machen oder ein eigenes Feld. Auch bei den Fest eingebauten Rollen.

The list used `.permission-list`, which is a flex row with a label on one side
and controls on the other. Right for a share. Wrong here, because a role says
**two** things — what it does on pages, and what it manages in the workspace —
and then a count, and then whether it can be edited. Four items on one line wrap
wherever they run out of room, which is what put "0 Personen, 0" above "Gruppen"
and split "Fest eingebaut" in half.

A card each, with the two halves **labelled** rather than run together with a
middle dot. `role.note` opens the screen by saying a role means a page level and
a set of rights; the list under it was the one place that did not make the
distinction visible. Rights are chips; "manages nothing" is said rather than
left blank, because an empty cell reads as something that failed to load.

The counts read as words — "Hat noch niemand" — rather than "0 Personen, 0
Gruppen", which is three numbers to read before learning the answer is nobody.

The system roles get cards too, asked for in those words, and still get no edit
control: an absent control says more plainly than a disabled one why it cannot
be changed.

---

## 3. Where you land was a per-workspace setting on a personal screen

> Die "Wo du landest"-Einstellung in den Persönlichen Einstellungen ist
> Workspace gebunden. Dort kann ich also nur auswählen aus den Seiten in dem
> Workspace in dem ich gerade bin. Das macht da keinen Sinn.

Correct, and it is a modelling fault rather than a placement one. `PRIMARY KEY
(user_id, workspace_id)` since migration 0024 — per person **and** per workspace — on
a screen whose scope is "you", which has exactly one workspace in view: whichever
one the person happens to be standing in. So it edited that workspace's row
while looking like a preference, and offered pages from wherever they were.

There was a test asserting the placement:

> "Where you land" is about a workspace and belongs to you, because two members
> have different answers.

Both halves of that are true and the conclusion was still wrong. The rule it
states — a section belongs to what it is *about* — is the rule that moves it.

### Two settings, because there were two things in one column

**The workspace's**, new: `workspaces.landing_mode` and `landing_page_id`, on
the `PATCH /api/workspaces/:id` route with `workspace.settings`, beside the name
and the icon. A place with a page saying what it is for could not send anybody
there at all — both old modes were personal.

**A person's**, kept, because migration 0024's reason has not stopped being true: two
people in one workspace work on different things. `workspace_landing.mode`
becomes nullable, and null means "follow the workspace" — a state the column
could not hold before.

**Four modes**, as asked: the page you were last on, the top of the tree, the
most recently edited page, or a chosen one. "Neuste" reads as last **edited**
rather than last created: it answers "where is the work", and a page created and
left alone — by an import, say — would otherwise be where everybody lands.

### The trap in the migration

`PUT …/landing` is called every few seconds while somebody reads, to record
where they are, and it inserted `COALESCE($3,'last')` along the way. Under the
old model that cost nothing, because `last` was also the only default. Under
this one it would pin every member to `last` within seconds of arriving and make
the workspace's first page unreachable for exactly the people it is for.

So: existing `'last'` rows become NULL, because they say "nobody chose" and not
"I chose last"; `'fixed'` rows are real choices and are kept. And the writer now
tells `'mode' in body` from `body.mode === null`, which is the distinction the
old code could not make. There is a test named for it.

---

## 4. The account menu on a phone opened at the far left

> Auf der mobilen Ansicht sitzt das Profilbild ja ganz rechts und das Menü das
> dann aufgeht sitzt dann ganz links.

The bar's rule pins the menu to both edges of the screen — deliberately, and the
comment says so. The base rule gives every account menu `inline-size: 200px`. A
positioned box with **both insets and a width** is over-constrained, so the
browser drops one inset; in a left-to-right document it drops the end. A 200px
menu against the left edge, under an avatar at the right.

`inline-size: auto` in the bar's rule, which is the half that was missing: the
recorded intent was a full-width sheet, and it was defeated by a width from
another rule.

---

## 5. The shares screen had no gutter on a phone

> Ist der Contentbereich bei Freigaben ohne Abstand zum Rand.

`.shares` carried its own copy of the reading column — `max-width: 46rem;
margin-inline: auto` — and not the `padding` that goes with it. Above 46rem the
auto margins hide that; below it there are none left to give, so the text sat
flush against both edges.

Two definitions of one measure, and the copy was missing the line that only
matters at the width nobody was testing at. The screen uses `.page-body` now,
like the trash and the inbox, and `.shares` holds only what is its own.

## Consequences

**Six route tests, eight landing tests, three stylesheet tests.** The stylesheet
ones are labelled as what they are: no test here lays anything out, so what they
check is the rules. The third is a real check rather than a wire — it reads both
blocks and decides whether the box is over-constrained.

**Four existing tests were rewritten, not deleted.** Three asserted decisions
this supersedes; the fourth read `input[type="email"]` on a field that is now a
search. Each says what changed.

**`you.landing` and its hint left the catalogue**, and the URL `/settings/landing`
is redirected rather than answered — a URL is a public contract (ADR-0016).

**`check-adr-references` cannot catch a citation of the wrong record.** Every
sentence above about the landing page was first written as "ADR-0024", because
the migration that built it is `0024_landing_page.sql` and the numbers look
alike. ADR-0024 exists — it is the OIDC record — so the checker was satisfied
and every one of those citations sent a reader to a document about identity
providers. Caught by opening the file. The reasoning for the landing page is in
the migration's own comments and in no ADR at all, which is why it is cited as
"migration 0024" throughout.

That is a real limit of the check, and not obviously worth closing: what it
verifies is that a citation points *somewhere*, and verifying that it points at
the right thing is a judgement a script cannot make. Worth knowing when reading
a citation in this repo: the number was checked, the subject was not.

**The instance directory is one prefix search away from a workspace admin.**
Stated plainly rather than mitigated further: two characters make it awkward,
not impossible, and the same caller could already confirm addresses one at a
time. If that becomes the wrong trade, the lever is the right, not the field.

## Alternatives considered

**Confirm an exact address without searching by name.** The smallest change that
answers "does this person exist", and not the one asked for — a name is what
somebody has in mind, and an address is what they have to look up first.

**Suggest only people who already share a workspace with the caller.** Strictly
better for the directory and it removes the main case: adding somebody you do
not yet share anything with is the whole point of the screen.

**One workspace-wide landing for everybody, no personal override.** Simpler, one
answer per workspace — and it would take away something people have today, to
fix a placement bug. Migration 0024's reason survives the move.

**Keep the landing in the personal settings and give it a workspace chooser**,
as shares and the trash have (ADR-0114). Smallest change, makes the data honest,
and leaves "this workspace has a first page" still unsayable.

**Give the account menu the right edge instead of both.** It would work. The
recorded intent was a full-width sheet, and the defect was that a width defeated
it — honouring the reasoning already written is cheaper than replacing it.
