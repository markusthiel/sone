# ADR-0110: A guest is a member

## Status

Accepted. Built. The last remainder recorded on
`claude/durchgang-nie-gelaufen.md`, and the one that was written down as a gap
in the tests.

## Context

The note said: *the membership and visibility half of `writeNotifications`'
INSERT has no test with a non-member or a restricted page.* True, and small —
the statement is eight lines, the missing cases are obvious, an afternoon.

The fourth test written against it passed a notification through to somebody
the same server refuses to open that page for.

```
JOIN workspace_members m ON m.workspace_id = p.workspace_id AND m.user_id = c.user_id
WHERE ${visiblePagesCondition('p', 'c.user_id')}
```

Both halves said yes for a **guest** on an ordinary page. The guest holds a
`workspace_members` row, so the join matches. And the condition's first branch
is "nothing on this page's path is restricted", which is true of an ordinary
page whoever is asking.

## The third resolver

ADR-0086 is about two resolvers that answered "may this person reach this page"
and disagreed for months, and ADR-0087 put the answer in one loader. There were
always three:

| | |
|---|---|
| `resolvePageAccess` | one page, for a fetch |
| `effectiveRole` | one page, for sync and the tree |
| `visiblePagesCondition` | SQL, for every list of pages |

The first two agree, and both say a guest holds nothing on an unrestricted
page: `page_level` is null for the `guest` role, because being in a workspace as
a guest means being shown particular things rather than everything.
`sync.db.test.ts` has asserted exactly that since ADR-0057 — *a guest without a
grant cannot open a page* — about an ordinary page.

The third said yes to the same guest on the same page. It is pasted into a dozen
`WHERE` clauses, so that answer reached:

- search results, with the matching sentence highlighted
- the workspace comment list, which is made of quotations from pages
- the template picker, the similar-page suggestions, the collection relation
  pickers and the values a rollup aggregates
- favourites and watching
- the workspace export archive
- the weekly digest mail
- and notifications, which is where it was found — the one that arrives by
  itself instead of waiting to be clicked

The tree is the exception: it computes `effectiveRole` per row afterwards and
drops what resolves to nothing. That second answer is what kept the sidebar
honest while everything else listed the workspace.

## Why nobody saw it

**The precondition was written down, and it was the wrong one.** The condition's
own comment said every caller establishes membership first, and this answers the
narrower question of what is withheld *within* a workspace somebody is already
in. Both clauses are true. Between them is the question neither one asks: what
does the workspace give this person at all. A guest passes the caller's check
and the condition's, and holds nothing.

**The test that exists for this drift could not fail.** `pageAccess.db.test.ts`
has had *the condition agrees with resolving one page* since ADR-0026, checking
the two answers against each other over four pairs. All four are pairs on a
**restricted** page — where the condition falls through to the grant branches
and is right. The one shape where the two differ is an ordinary page and
somebody whose role gives them nothing on one, and that pair was not in the
list. A guard aimed at exactly this fault, green from the day it was
written to the day this was found.

**And the sentence that would have given it away was in a test title.** The
internal-comments projection is commented "the insert joins `workspace_members`,
so only a member can ever be a recipient", and `sync.db.test.ts` carries that as
*a mention in an internal thread reaches a member, and only a member*. It is
reassurance about a share-link visitor, standing in for the question it does not
answer: not whether a recipient is a member, but whether a member may read the
page. Two hundred lines below it, the same file asserts that a guest may not.

## Decisions

### The condition asks both halves itself

`visiblePagesCondition` is now `effectiveRole(...) !== null` in SQL, which is
what it was always supposed to be:

```
user IS NOT NULL
AND <in this workspace at all>
AND (
      (nothing on the path is restricted AND <the workspace gives them a page level>)
   OR <the workspace gives them admin>
   OR <a grant of their own, at or below the fence>
   OR <a grant through a group, at or below the fence>
)
```

One clause is new — `anyPageLevelCondition` on the first branch — and one is
promoted from an assumption to a conjunct.

This is the ADR-0087 move again, and its argument verbatim: *a parameter every
caller has to compute correctly is a parameter one caller computes wrongly.* The
full-access flag used to be passed in, thirteen callers computed it, and one
passed the literal `false`. Membership was never even a parameter — it was a
sentence in a doc comment, which is the same arrangement with nothing to grep
for.

### Membership is required rather than assumed

A grant is a row, and a row does not know whether the person it names is still
here. The removal route deletes page grants and group memberships along with the
membership, deliberately, so rejoining does not silently restore what somebody
had — but a check that is only correct because another route behaved is correct
by luck. The cross-product test failed first on a non-member, not on the guest.

### One body, two predicates

`fullAccessCondition` and `anyPageLevelCondition` are the same SQL with
`page_level = 'admin'` and `page_level IS NOT NULL` in it, so they are one
private function and two exported names. The union with every group's role goes
with it, unchanged: being added to a group must never reduce what somebody could
already do (ADR-0026), so both read the membership's role **and** the groups'.

Its aliases are `wm`/`wr`/`wg` rather than `m`/`r`/`g`. This fragment is pasted
into statements that already join `workspace_members m` — `writeNotifications`
is one — and a subquery silently shadowing an outer alias is legal SQL and a
trap for the next reader. `activityDigest` has the same note about `w`, arrived
at the same way.

### The join in `writeNotifications` stays

It is no longer what keeps a stranger out. It is what a fifth caller of that
function inherits without having read any of this — the argument that file
already makes for applying `isAccountId` twice, three paragraphs further down.

## What it uncovered on the way

**ADR-0095's path-only fix only ever worked under a restricted ancestor.** A
page somebody reaches only as the path to a granted child has to appear in the
tree without its title, or the child is a root of the sidebar floating outside
the section it belongs to. `pathOnly` is `NOT visiblePagesCondition` — so for a
guest granted a page inside an ordinary folder, the folder was *visible*, hence
not path-only, hence resolved to no role, hence dropped by the same filter
ADR-0095 was written about. Exactly the symptom that ADR describes, still
happening, for the case it names.

`api.db.test.ts`'s *the page tree does not leak pages the caller cannot see* had
written the wrong answer down as the expected one: the granted page alone. It
now expects the folder beside it, path-only, with a null title. That test was
the only thing standing between the fix and the suite, and it was asserting the
bug — which is the fourth time in this project that a test held a fault in place
by describing it (ADR-0092, ADR-0094, ADR-0107).

## Consequences

**Fifteen tests in `whoMayBeTold.db.test.ts`, four of them failing before the
change**, and the eleven that passed are the point: the halves that already
worked — a stranger, a removed member, a restricted page, a grant — are what
made the four look impossible. Six of the fifteen assert that somebody *is*
told, because a visibility fix that overshoots is a workspace where nobody hears
anything.

**A guest's search, export, digest and comment list get smaller.** That is the
change, and it is user-visible: an instance that used a guest role as a cheap
read-only member has been showing those people the workspace, and will now show
them what they were granted. The remedy is a role with a `page_level`, which is
what a read-only member is (`viewer`), not a guest.

**The agreement test has the pairs it needed.** Two unrestricted ones, and the
new file asks the whole cross product — every person against every page — which
is the version that cannot be satisfied by choosing the pairs.

## Alternatives considered

**Fix it in `writeNotifications` alone**, which is what the note asked for. It
is one `AND` in one statement, and it leaves the same answer wrong in eleven
other places, including a digest mail that sends titles and excerpts out of the
building. The item was a question, and the answer to it was somewhere else.

**Have each caller add the page-level check.** Ten call sites, each two lines,
and the tenth is written next year by somebody who greps for how the ninth did
it. This is the arrangement that produced the bug.

**Drop the `guest` role, or give it `viewer`.** It would close the hole and
remove the only role that means "nothing unless granted" — which is what
external collaborators are for, and what page grants are for. The role is right;
the condition did not read it.

**Leave the tree's post-filter as the second answer and rely on it.** It is
already the reason the sidebar was honest. It is TypeScript over rows the SQL
returned, so it cannot help search, which needs the wrong rows gone *before*
`LIMIT` — a hidden page that occupies a result slot is itself a signal about
what exists (ADR-0026).

**Materialise the answer per person and page.** A table of who may see what,
kept by triggers. It makes every listing an index lookup and every grant, group
change, restriction, move and role edit a fan-out — and a stale row in it is
this same disclosure with no way to notice.
