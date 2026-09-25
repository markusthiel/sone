# ADR-0202: The logged-out screen says whose it is

## Status

Accepted. Built. SOTE carries the same arrangement.

## Context

> Branding von den beiden Login-Seiten bitte anpassen, Logo rein.

SONE's sign-in was the word "Anmelden", two fields and a button. Nothing else
— no mark, no name, no sentence saying what this is.

That is the one screen in the application where the mark is not decoration.
Everywhere else there is a rail, a workspace, a page, a breadcrumb: a dozen
things that say where you are. In front of a sign-in form there is only the
card. Somebody who followed a link, or opened a bookmark they made six months
ago, or was handed an address by a colleague, is being asked for a password by
a page that has not introduced itself.

SOTE did introduce itself — mark, name, claim — so the two applications also
disagreed about their own front door. Its wordmark, though, was set as a
section heading: weight 300, the type of a settings subtitle. The brand's
wordmark is Archivo 600 with +7.5% tracking. Two houses again, this time within
one screen.

## Decision

**Both sign-in screens carry the lockup and the claim**, in that order, as one
block above the form: mark and wordmark side by side in the brand's own
typography, the claim under them in muted small type, the pair spaced tighter
than the card spaces everything else because they are one thing and not two
lines.

**SONE uses `SoneLockup`, not the drawing.** An instance with a logo of its own
shows that logo and its own name (ADR-0123). Putting "SONE" over somebody
else's mark would be this software signing their letterhead — and an instance
that has gone to the trouble of setting a logo is exactly the one whose
sign-in should not say SONE.

**All four logged-out screens get it**, not only sign-in: first-run setup,
sign-in, password reset and account creation. They are all the front door,
reached by people who are not signed in, and three of them are reached by
following a link from an email — the case where knowing what you are opening
matters most.

**SOTE's wordmark becomes the brand's wordmark.** `SoteLockup` sets it at 600
with the brand tracking, the same component shape as SONE's.

## Consequences

- SONE keeps its `Anmelden` heading under the lockup and SOTE has none. That is
  deliberate rather than an oversight: SONE's heading names the *step*, and the
  same card is also "Konto anlegen" and "Passwort zurücksetzen", where the word
  is the only thing telling them apart.
- The claim is a new message in both catalogues, and the German one branches on
  the form of address — an instance set to "Sie" would otherwise have read "Auf
  deinem Server" on the very first screen. The guard that catches an unbranched
  familiar form caught this one before it shipped, which is the whole reason it
  exists.

## What was not done

**A picture, a colour field or anything else behind the card.** Every
self-hosted product of the last five years has a gradient there. The mark, the
name and one sentence are what the screen owes the reader; the rest is
somebody's screenshot being nice to itself.
