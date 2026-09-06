# ADR-0126: A link, sent

## Status

Accepted. Built. Asked for. Uses the letter ADR-0121 built and obeys the rule
ADR-0058 set. Changes one default in the share dialog and renames one field on
`/api/instance`.

## Context

> Seiten teilen per Mail, Links teilen per Mail, Gast-Links per Mail.

Three things in the concept, and in SONE they are one: a guest link is a share
link with `allowAnonymous` on, and sharing a page *is* handing somebody a link.
So this is one route and one form.

**What existed:** a link could be created, shown again, and revoked. Sending it
was copy-and-paste into whatever mail client somebody had open — which works,
and is also how a link ends up in a thread with fourteen people on it.

## Decisions

### The token never travels in the request

The browser sends an address and, optionally, a sentence. The server decrypts
the link it already holds — the same decryption the "show it again" route does —
and builds the URL itself.

A route that accepted a URL to mail would be **a route that mails any URL, from
an authenticated account, to anywhere**. That is a small open relay with this
instance's name on the envelope, and it would have looked like the obvious way
to write it, because the browser has the URL on screen.

Asserted on both sides: the server test checks the link in the letter was built
there, and the web test checks the call carries no URL — because the browser is
the side that would be tempted to pass the one it is already showing.

### What a share mail may say

A share mail does not break ADR-0058 — it is an invitation **to** content rather
than content — but it is the mail most likely to. So:

- **The link.** The one link in the letter; nothing else in it links anywhere.
- **Who sent it**, by display name. A name is not what the page says, and
  without it a share mail is an unexplained link from a stranger, which is the
  shape of every phishing mail ever sent.
- **Where**, subject to the instance's own setting: the page's title only where
  `emailDetail` is `title`, and the workspace's name otherwise. An operator who
  cannot accept a title reaching a mailbox has said so once, and the friendly
  mail somebody sends by hand has to obey it too.
- **When it expires.**
- **One sentence the sender typed.** The only content in the letter, and it is
  the sender's words rather than the page's — which is the distinction that
  keeps this an invitation rather than a leak. It never becomes a link of its
  own: a URL somebody typed into a note is a URL this instance would be vouching
  for, in a mail from a name the reader trusts.

And, specifically, **a password on the link is announced and never included.** A
link with a password and the password in the same message is a link with no
password — and adding it is the obvious "helpful" thing for a later change to
do, which is why there is a test named after it.

### A new link expires in thirty days

It was `never`. Both answers are one dropdown apart and both stay; what changed
is which one somebody gets by **not deciding** — and a link with no expiry is a
permanent grant made by a person who was thinking about the next twenty minutes.
`never` is still there, because a link to a page a team lives in should not
quietly stop working.

Asked for as *„vorbelegt, aber abwählbar"*.

### One address per send

Several recipients in one `To:` would tell each of them who else got the link,
which is a disclosure the sender did not necessarily intend. Sending one mail
each instead would need per-recipient bookkeeping and partial-failure reporting
for a case that is served by pressing send twice.

### The control is absent without a relay, and the route still answers

ADR-0059's rule, applied to the other thing that needs mail: the send form is
not there when the instance has none, because a control that can only ever fail
is worse than one that is not there.

The route still answers `no_relay` rather than assuming the interface got it
right — an operator may switch mail off between the page loading and the button
being pressed, and "sent" would be a lie the sender goes on to act on.

### `canResetPassword` becomes `canSendMail`

It named one *consequence* of the fact rather than the fact. A second reader
arrived, and two fields carrying one boolean is the duplication this codebase
keeps removing. What ADR-0059 decided is unchanged; only the name is.

## Consequences

**Eleven server tests and three web ones.** Most of the server ones are about
what must *not* be in the letter, because that is the half a later change would
break while making the mail friendlier.

**English only**, the gap ADR-0121 named — and here it is not a gap so much as
the honest answer: the recipient of a share mail usually has no account on this
instance, so there is nobody to ask what language they read.

**No tracking, still.** No per-recipient link, no open pixel, no record of
whether the mail was followed. ADR-0058 refuses those for notifications and
nothing about sending by hand changes the argument.

**Still open from the concept:** the export link by mail, the logo inlined into
the mail shell as `cid:`, the curated font pairs, and the contrast check as a
computed test — plus the six mails I proposed and Markus has not asked for.

## Alternatives considered

**Send the URL from the browser.** One fewer query and no decryption. It is the
open relay above.

**A mail with several recipients.** Convenient, and it publishes the recipient
list to everybody on it.

**Create-and-send in one step.** Fewer clicks for the common case, and it makes
the link's settings — role, subpages, password, expiry — decisions somebody
makes while thinking about an address. Creating and sending are two thoughts.

**Keep `never` as the default and explain the risk.** A warning that appears
every time is a warning nobody reads; a default is the thing people actually
get.

**Let the note carry links.** Somebody will want to include a second URL, and
then this instance's mail is a vehicle for arbitrary links under a trusted
sender's name.
