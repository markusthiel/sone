# ADR-0148: The guard reads the tree

## Status

Accepted. Built. Closes the hole ADR-0146 measured and left open.

## Context

The i18n guard from ADR-0041 is the reason this interface got translated at all:
a list of files that have been migrated, which may only grow, and a test that
refuses English in any of them. It has worked, and it has been wrong three
times — once per widening:

- a paragraph written across three lines never matched, so every long
  explanation in the administration area sat in English while the guard called
  the file clean;
- `{busy ? 'Creating…' : 'Create invitation'}` is not text after a `>`, so a
  button's two words hid behind a brace (ADR-0146);
- and a label written after `{' '}` is text after a `}`, which is the shape half
  the accounts row was written in.

Each hole was closed by widening a regular expression, and the next shape hid in
the next gap. That is not a run of bad luck. **Whether a string reaches the
screen is a property of the syntax, and a regular expression is a guess about
syntax.**

ADR-0146 measured what was left rather than estimating it: 33 strings in the
ternary shape, and about 29 more in template literals. The real number, once the
question was asked properly, was **130 strings in 28 files** — because attributes
a reader never sees on screen, and sentences split by an inline `<code>`, were
invisible to the old patterns too.

## Decisions

### The compiler already parses this

The guard reads the tree TypeScript builds. `test/helpers/readable.ts` walks it
and reports four things: JSX text, a literal an element renders, a literal in an
attribute somebody reads, and a label held in a data structure.

It is deliberately narrow about *reaching the screen*: recursion follows only
the shapes that pass a value along unchanged — a ternary's branches, the right
of `&&`, `??` and `||`, a template's own text, `+`, parentheses. **A call is not
one of them, which is exactly what `t('key')` is.** So a translated string is
never reported, and the ordinary case needs no exception at all.

### The guard is shown what it must catch

`test/helpers/readable.fixture.tsx` contains one of every shape, including the
three that hid, and a test reads the list back. A guard that has never been shown
a string it must find is a guard nobody has tested — which is how a file stayed
on the migrated list, reported clean, with eight English strings in it.

### An exception has a name and a reason, and is checked for still existing

Three strings stay literal: `STARTTLS (587)`, `TLS (465)` and the `docker exec`
line somebody pastes into a shell. A protocol is a name and a command is not
prose.

**Seven names left that list while this was being written**, which is the
interesting part of it. `YouTube`, `Vimeo`, `PeerTube`, `HLS`, `DASH`,
`SONE_OIDC_CLIENT_SECRET` and `/api/auth/oidc/callback` were listed because they
sat in markup as English words. They are values now — the sentence around them is
a message and the name is passed into it — so nothing about them is exempt any
more. **An exception that disappears when the code is written properly was never
an exception**, and a test refuses one that no longer matches anything.

### A sentence with a word in code is still one sentence

Three sentences in the single sign-on panel were written as three JSX children:
text, `<code>`, text. That is a sentence assembled from pieces, which ADR-0011
rejects — word order differs by language and a translator cannot move a `<code>`
element. Each is one message now, with the identifier inside it, and `withCode`
finds it again to set it apart. A translation that moves the identifier works; a
translation that drops it shows the sentence whole rather than losing a word.

### Counting is the catalogue's job

Fourteen places built a count in the markup — `{n} page{n === 1 ? '' : 's'}`,
`{n} {n === 1 ? 'person' : 'people'}`. Those are ICU plurals now, which is what
the catalogue has had since ADR-0041 and what German needs for its own reasons
(*„# Ordner"* and *„# Ordnern"* are not the same word).

## Consequences

**130 strings, 28 files, 89 new messages in both catalogues.** Nothing was
translated by pattern: several turned out to be duplicates of keys that already
existed, and three of my own new keys collided with existing ones, which the
compiler caught and which is the argument for a typed catalogue.

**Five source tests broke, and all five were asserting an English sentence**
sitting in a component — `/At least twelve characters/`, `/Owners and admins
still can/`, `/One for each account/`. Each now reads the key in the source and
the sentence in the catalogue, which is what it always meant. That is the sixth
through tenth source-text assertion in this repository to break on a move rather
than on a change of behaviour (ADR-0095, ADR-0102, ADR-0103, ADR-0147).

**`MoveDialog` lost a key that travelled inside a label.** Destinations were
built outside the component, so the root's name could not be translated where it
was made: the string `'move.root'` was stored in `label` and recognised again at
render. The builder takes the catalogue now, one place decides what a destination
is called, and the trail of ancestor names is translated too — it is shown, and
nothing had noticed.

**The guard was proved to bite** on a real file as well as on the fixture: a
string put back into `WorkspaceMenu` was reported with its file, line and shape.

**Not done:** the same reading is not applied to the files that are *not* on the
migrated list. The list is still the ratchet, and it still may only grow.

## Alternatives considered

**Widen the regular expressions again.** Three rounds of evidence say the next
shape hides in the next gap, and each widening also made the pattern harder to
read than the thing it was looking for.

**Extract with a tool at build time.** A real extraction step (keys generated,
catalogues merged) is a bigger machine than this project needs while one person
writes both languages, and it moves the check away from `pnpm test`, where it is
run by whoever is about to break it.

**Report only the shapes that have been seen to hide.** That is the regular
expressions again, in a nicer language.

**Leave the attributes out.** `title` and `aria-label` are exactly the strings
that stay English longest, because they are invisible to anybody reading the
screen — which is the argument for reading them first, not last.
