# ADR-0143: What to call a role

## Status

Accepted. Built. Closes *„Rollennamen sind nicht übersetzt"*, open since
ADR-0133 and filed there as *a question for the data, not for the mail*. It was
both, and the mail half was the worse one.

## Context

A workspace has four roles it did not make — owner, admin, member, guest — and
any number it did. The four are seeded in English by a migration:

```ts
{ key: 'owner', name: 'Owner', … }
```

Nobody chose that word. It is what the row holds so that a row has something in
it, and every decision in the codebase branches on the `key` instead
(ADR-0102). A role a workspace made has no key and a name somebody typed, and
that name is not translatable: there is no German for „Redaktion" to find.

So the rule is one line — **a word this application wrote is its to translate;
a name somebody typed is theirs.**

### It was written four times, and skipped in a fifth

`role.key ? t(\`role.${role.key}\`) : role.name`, in the roles panel, the groups
panel, and twice in the members screen — where the second copy's own comment
says it is *"the same rule as the picker in the table below"*. Somebody noticed
the duplication while making it.

And `roleLabel`, which the workspace header and the workspace settings screen
use, did not ask the question at all:

```ts
workspace?.roleName ?? workspace?.role ?? fallback
```

`roleName` for the four **is** the migration's English word. So a German
interface said **"Owner"** in its own header, and had done since roles stopped
being an enum. The two screens that got it wrong are the two whose author had no
copy of the condition nearby to paste.

### And the two letters about roles named them in the wrong language

ADR-0133 translated the letters. Its own finding was a resolver that existed and
nothing called; this is the mirror image — **the catalogue was translated and one
value walked past it**, because it came from a row rather than from a key:

```ts
role: chosen.name,
```

So a German reader of a fully German letter is told *„Sie sind jetzt Guest in
Haus."* On the two letters — access given, role changed — whose entire subject
is a role.

### The test named after a check it did not make

`accessTakenAway.db.test.ts` has had this since ADR-0128:

> test('a role change is announced with the new role', …)

It asserts the workspace and the person who acted. It never asserted the role.

That is the failure this codebase keeps finding, in a third costume: ADR-0135
found a comment promising a contrast ratio, ADR-0142 found markup promising a
keyboard, and here a **test title** promising a check. A name is not a check
either.

## Decisions

### The decision lives in `core`, the words stay in the catalogues

`nameOfRole(role, translate)`, beside `readableSize` and for its reason
(ADR-0138): a screen and a letter about the same thing have to call it the same
thing. It takes a translator rather than importing one, because `packages/web`
and `packages/server` each have their own catalogue and neither belongs in core.

**The key decides, not the name.** A workspace that renamed its `owner` row has
relabelled something, not changed what an owner is — and every other branch in
the codebase already reads the key.

### One place in the interface builds the message key

`roleLabel` takes `t` and builds `role.${key}` itself, so no component does.
That is what makes *"one place decides"* a check rather than a habit: a test
reads the source for the template and expects exactly one file.

`role.${key}.hint` is deliberately not that place. It answers a different
question — *what does this role mean* — which only the four can answer, and the
picker asks it once already.

### A placeholder written as data is a claim

The workspace settings screen filled a foreign workspace's standing with
`role: 'unknown', roleName: 'unknown'`, and that literal string reached the
screen. It is empty now, and the fallback is a translated sentence — the rule
`App` already writes where it builds comment-author rows: *a placeholder role
would be a claim about somebody.*

### The letters take the row, not its name

Both builders receive `{ key, name }` and call `roleWord`, which is
`nameOfRole` bound to the mail catalogue. Four new words in `words.en.ts` and
`words.de.ts`, capitalised, because the same slot holds a name somebody typed
and "You are now Redaktion" beside "you are now owner" is two answers to how a
role is written.

## Consequences

**Eleven tests. Four were red**, and they are the four faults: the helper
returned the row's word (two screens), and both letters named the role in the
row's language rather than the reader's.

**One red test was already there and asserting the fault.**
*„a system role keeps its own name"* — true of the code, wrong about the
product. Rewritten rather than deleted, as ADR-0118 requires, and it now says
what changed and why the old sentence was believable.

**One test got a check to match its name.** The role-change letter test asserts
the role now, which is what let the two beside it exist at all.

**The custom half is asserted in both languages**, on both letters and in the
helper, because the fix that would be easy and wrong is "translate the role
name", and nothing in a passing suite would have caught it.

## Alternatives considered

**Translate the role rows in the database.** A `name_de` column, or four rows
per language. The four are not data — they are words this application wrote,
and words this application wrote live in its catalogues. It would also leave
every custom role in a table that suggests it should have translations.

**Give the interface a `roleName` helper and leave the letters alone.** The
letters are where the fault was worst: a screen shows an English word beside
other English words a person may not notice, and a letter says *„Sie sind jetzt
Guest"* in the middle of a German sentence.

**Keep the condition at each call site and just fix `roleLabel`.** Four copies
and a fifth place that skipped it is exactly the arrangement that produced this;
adding the fifth copy would fix today and set up tomorrow.

**Translate `'custom'` too.** It is what a member row sends where the role has
no key — the *absence* of a system word, not a fifth one. Translating it would
put "Custom" where a name belongs.

**Lower-case English words, so "you are now owner" reads as a sentence.** It
reads better in exactly one of the two shapes this slot has, and worse beside
„Redaktion".
