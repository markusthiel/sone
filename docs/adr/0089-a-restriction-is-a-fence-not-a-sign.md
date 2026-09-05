# ADR-0089: A restriction is a fence, not a sign

## Status

Accepted. Built. Decides the finding ADR-0088 recorded and left open, and
corrects one direction of ADR-0026.

## Context

ADR-0088 recorded a finding and deliberately did not act on it:

> A grant on an ancestor with `include_subtree` reaches a *restricted* page
> below it. [...] Both resolvers agree, so it is the model speaking rather than
> a hole — but "only the people added below" reads like a fence, and a grant one
> level up walks through it.

It was recorded rather than fixed because changing it changes what every
existing subtree grant does, and that is a decision, not a bug fix. Markus made
it: **"Beides bitte reparieren"** — both findings, the path-only one first.

So: what did restricting a section actually do, before this?

It withheld the **workspace default**. A member whose role gives `editor`
everywhere got nothing on a restricted section, which is the case restriction
was built for and the case every test covered. What it did not withhold was an
**explicit grant** — and `include_subtree` makes a grant on a folder an explicit
grant on everything under it.

Put the two together and the result is the opposite of what the interface
promises. The people most likely to hold a subtree grant on the folder above a
sensitive section are precisely the people the section is being hidden from:
the project's own team, everybody who was given the department folder, whoever
was added to the group that owns that part of the tree. Restricting a section
inside a folder they hold did **nothing at all** against them. It worked only
against people who had never been given anything nearby — who could not see the
section in the first place.

That is not a strict rule with an exception. It is a rule that fails exactly
where it is needed and holds exactly where it is not.

The reason it survived this long is worth keeping. The agreement test
(ADR-0086) asks the two resolvers for the same answer, and both said `editor`.
They were consistent, and consistently open. A test that asks whether two
implementations agree cannot see a model that is wrong in both.

## Decision

**A restriction stops inherited access at its own edge. A grant counts if it was
made at or below where the restriction starts.**

Three consequences, stated so a stranger can act on them:

1. A grant made **on** the restricted page counts. That is what "nur die unten
   hinzugefügten Leute" means, and ADR-0026's rule that an explicit grant reaches
   a restricted page is unchanged for the page it was made on.
2. A grant made **below** the restricted page counts, for the pages it reaches.
   This is how one file inside a restricted section is given to one person —
   the case `path_only` exists to draw.
3. A grant made **above** it does not, however far its subtree reaches. It stops
   at the restriction, and does not resume underneath.

The same escape hatch as before: whoever the workspace makes a page admin keeps
`admin` regardless, or a restriction could lock out the only people able to undo
it.

Where a path carries several restrictions, only the **deepest** is checked.
Every other one is at or above it, so a grant that clears the deepest has
cleared them all by construction — and nothing strictly below the deepest is
restricted, because it is the deepest. This is why `PageLocation.restricted`
became `restrictedAt: string | null`: a boolean can answer "is the default
withheld", and cannot answer "was this grant made inside or outside", which is
the question a fence has to answer to be a fence.

Both resolvers implement it, because there are two and there have to be
(ADR-0086):

- `effectiveRole` compares positions on the page's path, with the fence found
  by `restrictedAtSql` — one SQL fragment, exported, used by all six queries
  that load a page location.
- `resolvePageAccess` gives its ancestry walk a depth and compares grants
  against `min(depth) WHERE restricted`.
- `visiblePagesCondition` compares `array_position` in the path against the
  deepest restricted position, in both the personal and the group branch.

Four new cases in `accessAgreement.db.test.ts`, and they were run against the
old code first: all four fail without the fence.

## Consequences

**This takes access away from people who have it today.** Anybody holding a
subtree grant above a restricted section loses it for that section. That is the
point, and it is the reason this needed a decision rather than a patch: for an
instance already in use, restricting a section now does something it did not do
yesterday, and somebody may lose a page they were reading last week. The
alternative is a promise the interface makes and the model does not keep.

**A restriction is now worth setting.** Before, it protected against strangers,
which is what workspace membership already does. Now it is the tool for the
thing it is named after: a section inside a shared area that only named people
enter.

**`restrictedAt` surfaced a latent bug in two places.** `export/routes.ts` and
`import/routes.ts` were reading `pages.restricted` — the page's **own** column,
not the inherited one — so both said "not restricted" for every page inside a
restricted section. The export route therefore let somebody export a page whose
document the sync layer would have refused them. Neither was found by a test;
both were found by the compiler, because changing a boolean to an id makes
every reader say where its value comes from. This is the second time this
session that a type change was the diagnostic instrument.

**And then it surfaced six more, which is the real find.** One sentence appeared
in seven places in `pages.ts`:

> The listing condition above already excluded restricted pages, so this second
> check only has to agree with it.

It is true in one of them — the search route, whose query really does carry
`visiblePagesCondition`. In the other six there is no listing at all. The page
arrives as an id in the URL or the request body, or the query lists everything
and the per-row check is the only filter there is. Each of those six passed a
literal "not restricted" to `effectiveRole`, so the resolver — which was right
throughout — was asked about a page that did not exist:

| Route | What a member could do |
|---|---|
| `GET /api/pages/:id` | read a restricted page's title, icon, kind and cover by id |
| `GET /api/workspaces/:id/tags` | see tags, and counts, from inside a restricted section |
| `GET /api/workspaces/:id/trash` | see restricted pages listed as restorable |
| `POST …/pages` (create) | create a page inside a restricted folder |
| `POST /api/pages/:id/restore` | restore a page **into** a restricted folder |
| `POST …/versions/:id/restore` | overwrite a restricted page with an earlier state of itself |

The first is the one ADR-0026 names explicitly: *"a title in a search result is
a disclosure, however carefully the page itself is protected."* The tree has
hidden these pages since restrictions existed; the route that hands out one
page's metadata never did.

`test/restrictedRoutes.db.test.ts` asks all six as a **member**, and each one
was run against the old code first: all six fail without the change. A member,
deliberately — a guest was already refused by the role, so the routes looked
correct to every test that used one, and a member is exactly who a restriction
is set against.

The lesson is narrower than "read your comments". A comment that says *why a
check is unnecessary* is load-bearing, and this one was copied to six routes
where its premise was false. Nothing mechanical catches that. What caught it was
making the value impossible to omit: a `false` with a paragraph of justification
reads as considered, and a `restrictedAt` that has to come from somewhere makes
the omission visible.

**Share links inherit the rule.** A link scoped at a folder no longer reaches a
restricted page inside it. That follows from the same loop and needed no
separate code, which is the payoff for a share token being claims like any
other (ADR-0006).

**The agreement test is not enough on its own.** It proves the two resolvers say
the same thing; it cannot prove that what they say is what the interface
promises. That gap is what this ADR closed, and there is no mechanical guard
for it — only reading the promise the screen makes and asking whether the model
keeps it.

## Alternatives considered

**Leave it, and change the wording instead.** Say "the workspace default does
not apply here" rather than "only the people added below". Honest, cheap, and it
makes the feature useless: an access rule that has to be explained by what it
does *not* do is one nobody will reach for.

**Only stop grants that are inherited, and only for non-members.** Would have
kept every existing member's access intact. Rejected: it makes the rule depend
on who is asking, so two people with the same grant on the same page get
different answers, and nobody can predict either.

**Make it a per-page choice — "strict" restriction next to the ordinary one.**
Both behaviours, chosen where the restriction is set. Rejected: two kinds of
restriction is two things to explain, and the weak one would remain the default
for everybody who does not read the difference — which is everybody. If one of
the two is right, the other is a trap.

**Check every restriction on the path, not just the deepest.** Considered and
found to be the same rule: a grant clearing the deepest has cleared the rest.
The single check is not an optimisation, it is the observation that the others
cannot matter — and the test `the deepest restriction is the one that counts`
is there so the next reader does not have to re-derive it.
