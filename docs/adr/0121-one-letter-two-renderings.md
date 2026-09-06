# ADR-0121: One letter, two renderings

## Status

Accepted. Built. Asked for. Amends the "plain text only" half of ADR-0058;
everything ADR-0058 says about *content* stands unchanged.

## Context

> Wir sollten noch mehr aus unserer E-Mail Anbindung rausholen? Einladung
> Versand an neue Team Mitglieder per Email. Hinzufügen zu Workspace per Email
> an das neue Mitglied bestätigen, da wäre dann ja nichts zu tun, aber eine Info
> per Mail macht Sinn. […] Außerdem ein schönes Mail Design.

Two of those are missing features. The third argues with a rule.

**What already existed**, checked rather than assumed: notification mails, the
weekly digest, the password reset (ADR-0059), the "this account signs in through
your provider" mail, the second-factor announcements, and replies arriving back
as comments over IMAP (ADR-0060).

**What did not:** an invitation created a link and handed it back for an
administrator to paste into a mail of their own. Adding somebody to a workspace
told them nothing at all.

### The rule the design request argues with

`compose.ts`, on its own output:

> Plain text only: an HTML mail is a second thing to keep true.

That is right about **two documents** and wrong as a bar on two renderings. What
it protects against is a text part and an HTML part maintained side by side,
which drift: a line added to one, forgotten in the other, and only half the
recipients ever see the difference.

## Decisions

### A mail is a structure; both forms are rendered from it

`Letter` — subject, an optional heading, lines (each with an optional link and
an optional `under` for a detail belonging to the line above), one action, a
footer. `renderText` and `renderHtml` both take one.

There is then nothing to keep in step. **A line added to a letter appears in
both or in neither**, which is the property the old rule was reaching for, and
there is a test that asserts exactly that against both renderings.

**Who and where, never what, is untouched.** This module decides how a letter
looks; what may go in one is decided where it is built, as before. A prettier
mail must not become a mail that says more — so the test for it runs against
both forms, and the instance's `detail: 'workspace'` setting still decides
whether a page may be named at all.

### The HTML shell

A **table**, because flexbox and grid do not survive Outlook. Styles **inline**,
because Gmail removes `<style>` — so the inline values are the light ones and a
client that strips the block still shows a mail that reads. The block carries
only the dark-mode query, which cannot be inlined at all. 600px.

**No remote images.** Not a logo, not a spacer, not a pixel. A remote image
tells the sender when a mail was opened and roughly from where, and this project
does not measure that (ADR-0058 refuses per-recipient links for the same
reason). The wordmark is text until an instance has a logo of its own to inline
— which is the branding step in the concept, and this is what it will hook into.

**Everything a person typed is escaped**, and every `href` must be `http(s)`.
Page titles and display names reach these lines; the URL rule is a fact about
the *type* rather than about today's callers, and `javascript:` in an `href` is
one caller away. A refused link drops the link and keeps the line: a mail that
arrived saying what happened is worth more than one that did not arrive.

### `multipart/alternative`, text first

The order is the contract: a client shows the **last** part it can display.
Reversed, every graphical client would show the plain text.

The boundary is random per message. A body containing a fixed boundary would end
its part early and the rest would arrive as MIME wreckage — and a fixed one is a
string somebody's page title eventually contains, silently.

A mail with no HTML part is sent exactly as before. Most are.

### Two mails that were missing

**An invitation is sent.** `mailed` comes back in the reply rather than being
assumed, so a screen can offer the link to pass on by hand when there is no
relay instead of implying a mail arrived. An invitation with no address on it is
unchanged: a link, and `mailed: false`.

**Somebody let into a workspace is told** — the place, who let them in, the role,
the way there. **No token and no link to accept**, because there is nothing to
accept; a mail that looked like an invitation would have somebody hunting for a
button that does not exist.

**A failed send never undoes the act.** They have the access whether or not
their mailbox took a message about it, and failing the request would be undoing
a grant that succeeded, for a courtesy. There is a test for that specifically.

**Absent, not broken.** No relay means no `sendLetter`, and the mail simply does
not happen — ADR-0059's rule for the reset link, applied here.

## Consequences

**Nine letter tests, three send tests, four route tests.** The letter ones are
about what must be true of *both* renderings, because that is what the old rule
was protecting.

**The digest and the notification mail moved onto letters too.** Leaving them
would be two ways to build a mail, which is the shape this project keeps finding
and removing. Their text output is deliberately close to what it was; what they
gain is the drawn form.

**These two new mails are English only**, and that is a gap rather than a
decision. A notification is written in the reader's language because the reader
has an account with a language on it (ADR-0041); an invitation goes to somebody
who has no account yet, and the access mail is sent before anybody asks the
account what it prefers. Named in the code so the next person does not have to
work out whether it was on purpose.

**Still to come from the concept:** the export link, sharing pages and guest
links by mail, and the ones I proposed — access withdrawn, a sign-in from a new
device, an invitation nobody redeemed, a relay that has stopped working. Each
now costs its structure and nothing else, which was the point of doing this
first.

## Alternatives considered

**Keep plain text.** It is the cheapest thing that works, and it was asked
against. The rule it rests on is about maintaining two documents, and that is
the part this removes.

**A template language.** More flexible per mail and it puts markup back in the
hands of each caller — which is how the text part and the HTML part start
disagreeing again, one template at a time.

**Send only HTML.** Half the argument for multipart disappears and so does the
text-only client, the screen reader set to prefer text, and the list that strips
HTML. The plain part is not a fallback; it is the same letter.

**Attach the export to its mail** rather than linking it. A workspace archive is
arbitrarily large, and an archive sitting in a mailbox is precisely "the backup
nobody chose to take" that ADR-0109 names. The link expires; the mailbox does
not.
