# ADR-0186: A share credential per link, and an unlock the HTTP side can see

## Status

Accepted. Built. Findings F10 and F11 from the external review — both about the
share cookie, and both functional rather than security: things failed closed,
they just failed. The account-cookie half of F10 (a link marked
„Anmeldung erforderlich" trusting the mere presence of a session cookie) was a
real hole and is already fixed in ADR-0182; what is left here is the parts that
merely did not work.

## Context

A share visitor's only HTTP credential is the `sone_share` cookie: an `<img
src>` and an attachment download cannot send a header, so the cookie is how a
picture in a shared page is authorised. Two things about that cookie were wrong.

### F10 — a password link had no HTTP credential at all

A password link checks its password on the sync connection, which opens the
document. But the cookie was deliberately *not* set for a password link until
then (issuing it before the password would make the password decorative), and
nothing set it afterwards either — the sync connection is a WebSocket and cannot
set a cookie. So the document opened and everything else on the page did not:
images, attachments, HTTP comment actions, the shared subtree, the author list.
All 401 or 404 — failing closed, but a password link was usable only for pages
that were pure text.

The shared-subtree and author routes had a second, smaller version of the same
gap even for account links, fixed in ADR-0182 by passing `signedIn`; they still
did not know about a password unlock.

### F11 — one cookie for every link

`sone_share` held a single token with `Path=/`. Open link A in one tab and link
B in another, and B's resolution overwrote A's cookie for the whole origin. A's
tab then loaded its images with B's token and got 404s, and reloading A flipped
it back — the two tabs fighting over one credential. No access crossed a
boundary (every request is still authorised against whatever token it presents),
but a visitor with two links open saw half-broken pages.

## Decisions

**The cookie is a list of tokens (F11).** `sone_share` now holds a
space-separated list, and `setShareCookie` merges a new token into whatever the
request already carried rather than replacing it, capped at eight so the header
cannot grow without bound. A legacy single-token value parses as a one-element
list, so nothing migrates.

**`claimsForRequest` merges the grants of every held link.** Which token grants
the resource is not decided in `claimsForRequest` — it returns claims and the
caller runs `effectiveRole` against the specific page. So it resolves every
token that reaches the workspace and returns the *union* of their grants; the
caller then finds the one that reaches the page. Returning just the first
matching token's claims would 404 a file that a different held link grants —
which is exactly what the naïve first-wins loop did in testing. A member's own
session is still tried first and wins outright when it grants access, because a
member's rights are never less than a link's.

**A password unlock leaves a proof the HTTP side can present (F10).** A new
`POST /api/share/:token/unlock` takes the password, verifies it, mints the
`share_sessions` row, and sets two cookies: the token (so the browser carries
it) and an unlock pair `sone_share_unlock: <token>:<sessionId>`. On later
requests, the resolver treats a live share session bound to the token as proof
the password was given — because a session is minted only after a correct
password — so an image or attachment succeeds without the password travelling on
every request. The shared-subtree and author routes read the same unlock cookie,
so a password link's tree and authors load once it is open. The client calls the
unlock endpoint once, right after it submits the password to the sync
connection.

The unlock cookie, like the token cookie, is HttpOnly, `SameSite=Lax`,
session-scoped, and keyed by token so two unlocked links do not evict each
other.

## Consequences

A password link now works as a link, not just as a document: its images,
attachments, comments, subtree and authors load after it is unlocked. Two links
open in two tabs both keep working. Nothing here widens access — every request is
still authorised against the tokens the browser actually holds and the unlock a
password actually earned; the change is that the browser can now hold more than
one link, and that a password link's unlock reaches the parts of the page that
are not the document.

`share.db.test.ts` covers the unlock route (right password sets both cookies,
wrong password sets nothing and is refused) and a password link's subtree
loading only after unlock. `files.db.test.ts` covers two tokens in one cookie
each loading its own file. A browser end-to-end for the full password-link page —
open, load an image, download an attachment — is the remaining coverage and is
left for the E2E suite; the server contract it would exercise is tested here.

## Alternatives considered

**Send the token as a query parameter or header instead of a cookie.** An `<img
src>` cannot set a header, and a token in a URL lands in logs, referrers and
shoulder-surfing range. The cookie is the shape that works for the requests that
need it; the fix is to let it hold more than one, not to move it.

**Set the share cookie for a password link up front and check the password only
on sync.** That is the "decorative password" the cookie was withheld to avoid: a
cookie handed out before the password is entered is a credential the password did
not gate. The unlock route sets the cookie only after verifying the password.

**Re-verify the password on every HTTP request.** Correct but expensive — a
password verify is deliberately slow — and the password would then travel on
every image request. A share session minted by one correct verification is the
standard bearer-proof shape, and it already existed for the sync side.
