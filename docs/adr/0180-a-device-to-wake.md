# ADR-0180: A device to wake

## Status

Accepted. Built. **Not measured on a phone or an iPad** — see Consequences.

## Context

> Und jetzt bitte noch echte. App Benachrichtigungen die ich ein und ausschalten
> kann im Profil.

SONE already tells people things. The bell updates live while the tab is open
(ADR-0091), the inbox keeps what was said (ADR-0052), and mail goes out on a
timing each person sets (ADR-0075, ADR-0128). Every one of those needs the
application open or an inbox checked. *Echt* means the phone in a pocket lights
up.

What was already there, verified before building: a PWA manifest and icons, but
**no service worker** — so nothing on the device could be woken; a notification
section in the profile with the digest and the per-kind mail timing, which is
where a switch belongs; a job queue with a runner and `enqueue`; and a session
cookie that is `HttpOnly; SameSite=Lax; Path=/`, which decides more than it
looks (below).

Web Push is two specifications that are usually shipped together and are not the
same thing. **RFC 8292** signs a push so a push service knows which application
sent it. **RFC 8291** encrypts a payload so the push service cannot read what is
in it. Everything hard about Web Push on a server — the key agreement, the HKDF,
the record framing — is the second one.

## Decisions

### The push carries nothing

The server sends an empty, VAPID-signed POST. The service worker wakes, asks
`/api/inbox?unread=true` over the session the browser already has, and draws the
newest thing waiting.

This is the decision the rest follows from.

**Nothing about a page, a comment or a person passes through Apple's or Google's
push service, because there is nothing in the request to pass.** A self-hosted
instance whose whole point is that the content stays on the operator's machine
should not be handing excerpts to a third party at the one moment it is most
readable — and an excerpt is exactly what a notification is made of. There is no
encryption to get right because there is nothing to encrypt. RFC 8291 is not
implemented, not depended on, and not a thing that can be got subtly wrong here.

It costs one request at the moment of waking, which is a moment the device is
awake anyway. And it gets the freshness right by accident: what is shown is what
is unread *now*, not what was unread when the push was queued, so a notification
read on the laptop does not light up the phone thirty seconds later.

The session cookie is what makes it work. `SameSite=Lax` and `Path=/` mean the
service worker's own same-origin `fetch` carries it; nothing new is issued, and
a device that has signed out gets an answer that tells it nothing.

### The private key is not a setting

`instance_settings` is scoped in writing to *administrator-changeable settings*.
A VAPID private key is neither changeable nor a setting: changing it invalidates
every subscription ever made against it, which looks to everybody like
notifications silently stopping. So it lives in its own table, `push_identity`,
with a `only_row boolean PRIMARY KEY CHECK (only_row)` — one row, enforced by
the schema rather than by everyone remembering.

It is made on first use, which is the first time a browser asks for the public
key, so **an instance where nobody switches this on never generates one**. Two
workers asking at once get one key: the insert is `ON CONFLICT DO NOTHING`
followed by a re-read, never a read followed by a write.

### One row per endpoint, so a device that changes hands moves

`push_subscriptions` is keyed on the endpoint, not on a pair. The same browser
with a second person signed in is one device, and `ON CONFLICT … DO UPDATE SET
user_id = EXCLUDED.user_id` moves it. Two rows would be two pushes for one
notification, and one of them would be to somebody who has signed out.

### What the push service answers decides whether the row survives

**404 and 410 delete. Everything else counts.** A push service answers 410 for a
subscription that is genuinely gone and 500 for an afternoon it is having, and
treating the second like the first switches somebody's notifications off because
Apple was briefly unwell — and they would find out by never being told anything
again. A failure increments `failures`; a success clears it and stamps
`last_ok_at`. Nothing yet deletes on a count; the column is there so that
deciding later is a query rather than an archaeology.

### The send is a job, in the notification's own transaction

The notification row is written inside the transaction that projects a page
(ADR-0008). Sending from there would put several requests to Apple inside a
database transaction, hold row locks for the slowest of them, and roll the
projection back if one failed. So the same transaction writes a **job** —
a second insert, no network — and the runner sends.

Which also fixes the order for free: a push about a notification that was rolled
back is a notification somebody opens the application to find gone.

`writeNotifications` had a known shape: it only ever inserts, `ON CONFLICT DO
NOTHING`, because a page is reprojected on every edit. It now ends `RETURNING
user_id`, so **who was newly told** is the list that gets woken — not everybody
mentioned on the page, every time anybody types.

### Per device, and the interface says so

A subscription belongs to one browser on one machine. Switching it off on the
iPad must not stop the phone, which is what *„auf diesem Gerät"* means — so it
is the one answer in that section that is not about an address, and it sits
first, above the mail, rather than reading as an account-wide switch.

Four states, told apart because the way out of each differs:

| | what it is | the way out |
|---|---|---|
| `unsupported` | no service worker or no push | a sentence: iOS shows these for a web application only once it is on the home screen |
| `denied` | the browser was told no | its own settings; asking again does nothing, silently |
| `off` | available, not on | the button |
| `on` | on here, and the server agrees | the button |

The two that cannot be acted on show a sentence rather than a switch that does
nothing.

**`on` requires the server to agree**, not just the browser. A subscription the
server has forgotten — a database restored from before it, an endpoint deleted
as gone — would otherwise read as on and never arrive. A server that cannot be
reached also reads as off: the honest answer is "we do not know that this
works", and a switch that says on while nothing comes is the one thing worse
than one that says off.

### Off tells the server first

Then the browser. A row the server no longer has is a push nobody sends; the
other order leaves a row that sends to a subscription that is gone — which is a
notification somebody switched off still arriving.

### The worker is served verbatim from `public/`

A service worker's scope is the directory it is served from, and one that
arrived at a hashed build path would control that path and nothing else. So
`sw.js` is plain JavaScript in `public/`, copied to the web root unchanged, and
its address does not move with a release. A worker whose address changed would
be a second worker.

It caches nothing and intercepts nothing. Serving the application offline is a
different feature with different failures, and this one has no business deciding
what a page looks like.

## Consequences

**36 tests.** Nine on the signature — including verifying one back against the
exported public key, because a JWT that is merely well-shaped is a push that is
refused. Twelve against the database: the keypair made once including by two
askers at once, a wake reaching every device of one person and nobody else's,
410 deleting where 500 counts, an endpoint changing hands, and that the request
**has no body at all**. Fifteen on the switch, which are all about order and
about which answer wins.

### What the tests agreed with until one of them disagreed

The outcome of a run was first written **by person**: `failures + 1` for
everybody woken if anything failed, `failures = 0` for everybody if anything
succeeded. Eleven passing tests agreed, because each of them answers one status
for every endpoint — a phone and a laptop that are always both fine or both
broken are indistinguishable from a count kept per person.

A twelfth, answering 201 to one endpoint and 500 to the other, does not: the
laptop's failure count was being cleared because the phone was fine. The outcome
is now three lists of endpoints, and the row that failed is the row that is
marked. **A fixture that gives every case the same answer cannot see a rule that
is about telling cases apart** — the same shape as the fixtures that agreed only
with themselves in ADR-0171 and ADR-0179, one level up.

Migration **0078**. An operator pulls and restarts; nothing else. The feature is
off for everybody until each person switches it on at each device.

### Not measured where it matters

Every test here runs against a push service made of objects, and the real ones
are Apple's and Google's. Specifically unverified:

- that iOS delivers a push to a SONE added to the home screen at all, and that
  it does **not** in a plain Safari tab, which is what the `unsupported`
  sentence claims;
- that an empty push with `Content-Encoding: aes128gcm` and `Content-Length: 0`
  is accepted by both services rather than rejected as malformed;
- that `userVisibleOnly` is satisfied by a notification shown after an
  intervening `fetch` — Chrome's patience for the round trip is documented as
  a few seconds and not as a number;
- what a phone that has been offline for a day does with a push whose TTL was
  an hour.

This is the second round running (after ADR-0179) that ships something whose
behaviour lives on a device I do not have. It is worth saying plainly rather
than quietly: **it is built, it is tested, it has not been seen working on a
phone.**

### Left open

The excerpt in the notification is drawn as the inbox gives it, so a long
comment is a long line on a lock screen; no truncation is done here. Nothing
deletes an endpoint on repeated failure. There is no per-kind choice on a
device — a device is on or off, while mail has a timing per kind — and that
asymmetry will be somebody's question eventually.

## Alternatives considered

**Encrypt a payload (RFC 8291).** The notification would show without a request,
and would work while the device is offline between the push and the ask. It also
means the excerpt travels through a third party and that the hardest cryptography
in the feature becomes load-bearing. The offline case is real and is handled by
showing a quiet "there is something new" instead — which is the same amount of
information a lock screen gives at a glance anyway.

**A library for the sending.** `web-push` does both RFCs and is well travelled.
It is also a dependency in the path of something that must not break silently,
for a feature that — once the payload is gone — is a signed JWT and a POST.
Written here, verified against the exported key, in a file of about a hundred
lines.

**Native applications.** They are the only way to get a notification onto an iOS
device that has not added the web application to the home screen. A different
project.

**A switch per account rather than per device.** Simpler, and wrong the first
time somebody silences their iPad in the evening and finds their phone silenced
too.
