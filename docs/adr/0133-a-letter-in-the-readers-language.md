# ADR-0133: A letter in the reader's language

## Status

Accepted. Built. The last thing left over from the whole run of mail work, named
in ADR-0132's consequences as *"the letters are English only"*.

## Context

Twelve letters, and eleven of them said this:

```ts
locale: 'en',
```

Not as an oversight in one place. As a line typed twelve times, next to twelve
sets of English sentences, over six records.

And this has been in `i18n/locale.ts` since ADR-0011, exported, with a docstring
stating the order it answers in:

> The locale to address a user in. Order: the user's own setting, then the
> workspace default, then English. **The requesting user's locale never enters
> into it** — an invitation sent by a German admin to a French colleague must
> arrive in French.

**Nothing has ever called it.** The resolver was not missing; the wire from it to
the letters was.

Two of the modules had written down why they were English, and the reasons are
worth quoting because one of them is half wrong and the other is wrong about a
word:

> English only, and that is a gap rather than a decision: a notification mail is
> written in the *reader's* language because the reader has an account with a
> language on it. **Neither of these has one** […]

Three of that module's four letters go to somebody this instance has a row for —
`tellAbout` is *handed their user id*.

> English, the gap ADR-0121 named: the recipient of a share mail **usually** has
> no account here, so there is nobody to ask what they read.

Usually. An address is not the same thing as no account.

## Decisions

### The words are a catalogue, and the type checker is the completeness check

`words.en.ts` and `words.de.ts`, the arrangement the interface has had since
ADR-0041, for its reason: `de` is declared as `Record<keyof typeof en, string>`,
so a key added in English and forgotten in German **does not compile**. A
translation file where keys can be missing is a translation file with holes that
nobody sees until a German reader gets an English mail.

One catalogue rather than a table beside each letter. The one letter that *was*
bilingual had a private table, and it is the proof: eleven letters were written
next to it in English, because a table private to one file is not a place
anybody adds a sentence to. That table has moved in with the rest.

**And a test says no letter may be written outside it.** A `subject:` or a line
built from a string literal is a sentence that exists in one language, and it
will be added by somebody adding a letter rather than by somebody translating
one — which is exactly how these eleven happened.

### Two questions, not one: which language, and how to address somebody

The **language** is the reader's. The **address** — „du" or „Sie" — is the
instance's: one setting for everything this server says, and it already existed,
used by nothing but the interface. A German instance that has chosen Sie must not
have mails that say du, and a catalogue without this is exactly that instance.

So it is a `{address, select, …}` in the German strings and absent from the
English ones, which have no such distinction to make. `formatMessage` leaves an
unused value alone, so nothing is passed differently.

**A sentence with no address in it gets no branch.** „Ein Browser ist kein Beweis
dafür, wer ihn benutzt hat" is the same sentence in both, and a branch around it
would be a line maintained twice in order to be the same twice.

### The recipient decides, and the recipient is not the sender

`recipientLocale` where there is a user id — which is ten of the twelve. In
`tellAbout` this is the line the resolver was written for: a German administrator
taking away a French colleague's access sends a French letter. The other way
round is a mail that is easier for the person who does not have to read it.

**Per recipient, not per run.** The outage report goes to every instance
administrator, and they need not share a language because they share a server.

### An address is not "no account", and a stranger is answered by the place

For the two letters that go to a mailbox — an invitation and a shared link —
`addressLocale`: an account with that address if there is one, then the
workspace's own language, then English.

The first step is a query. A colleague being sent a link has a row in `users`
with a language on it, and never asking was the assumption both letters rested
on. A **deactivated** account does not answer: their language is not a fact about
whoever holds that mailbox now.

The second step is the argument worth making. A workspace's language is not the
sender's language dressed up — it is chosen for the *place*, and a page in a
German workspace is more likely to be read in German than in English. It is a
guess; so was "always English", and this is the better one. It is also the second
step `recipientLocale` already takes, for exactly this reason.

Where there is genuinely nobody and no place — the invitation to the *instance* —
English, which is the honest end of the order rather than a gap.

### Two bugs the German found

**`# ` belonged to a plural and was being applied to a `select` too**, using the
select's own value. Nothing had ever written one inside a select branch, so it
sat in `formatMessage` until a German mail put a plural inside
`{address, select, …}` and *„Sie haben # Tage"* came out as *„Sie haben formal
Tage"*. The interface was one `#` away from the same thing. Found by probing the
real function rather than by reading it.

**`address` was a value name and the form of address at once.** `device.where`
said *"Just now, from {address}"*, meaning the network address, and `address` is
handed to every message as „du" or „Sie" — so the English rendered *"Just now,
from informal."* A reserved name is only reserved if something says so, and now
a test does.

### The formatter is `core`'s, because a mail is a message too

It lived in `packages/web` while the interface was the only thing with a
catalogue. The alternative to moving it was a second implementation whose
difference from the first nobody would notice until a German reader met a
sentence written for English grammar. Nothing in it touches a DOM or a database,
which is what made it movable.

### Plurals are plurals — and that fixes the English too

The letters said `${days} day(s)`, `${n} page(s)`, `${count} other(s)`. A ternary
would have been no better: `n === 1 ? 'day' : 'days'` is English grammar written
in code, and German has different rules around zero, Polish four forms.

So a count is a plural in the catalogue. **The English is better for it** — "one
page changed" rather than "1 page(s) changed" — which is the useful thing to
notice about translating: it does not only add a language, it finds every place
the first one was written like a form letter.

The same applies to `${title}${who}` in the digest, where `who` was
` — Anna and 2 other(s)`: three separate things a translator cannot reach, and a
language that puts the attribution elsewhere in the sentence cannot express at
all. The whole line comes from the catalogue now.

## Consequences

**Twelve letters in two languages**, from one catalogue, with the address form
this instance chose.

**Nine database tests and seven catalogue tests.** The catalogue ones are the
ones that will still matter in a year: that German says everything English says,
that every message formats in both with nothing left showing, that no count is
written with a bracket, that any German sentence addressing the reader asks how
this instance does it, and that no letter is written outside the catalogue at
all.

**A bug fixed in the interface's own formatter**, which had been reachable from
the day it was written.

**A locale corrected where it was already resolved:** the notification mail read
`u.locale` alone, so a member of a German workspace who had never opened the
language setting — which is most people — got English from a server whose every
screen was German. It is `coalesce(u.locale, w.default_locale)` now, the second
step of the order it was half-implementing.

**Still open, and deliberately:** *role names are not translated.* "Owner",
"Admin", "Member", "Guest" are rows in `roles`, shown untranslated in the German
interface too, and a workspace's own role is a name somebody typed. Translating
the four built-ins alone would make a mail disagree with the screen it describes.
That is a question about the data, not about the mails.

## Alternatives considered

**A table of words beside each letter**, the way the notification mail had one.
It is how eleven letters came to be English: a table private to one file is not
somewhere a translator can be sent.

**Translating at send time from an English original.** A machine translation of a
security notice is a security notice whose wording nobody has read.

**The sender's language.** Convenient — the request has one — and wrong, which
`recipientLocale`'s own docstring said before any of this was written.

**A `de-formal` catalogue.** Every German string twice, and two catalogues drift.
The `select` is one branch in the strings that have an address in them, which is
about a third of them.

**Leaving the digest and the notification alone**, since one was already
bilingual. Then the record's central claim — one catalogue, one place a
translator works — would have been untrue on the day it was written.
