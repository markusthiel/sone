# ADR-0130: The first time, and every new one

## Status

Accepted. Built. Asked for. The last two of the six mails proposed beside
ADR-0121, which completes that list.

## Context

> 2. **Anmeldung von einem neuen Gerät.** Auf einer selbst gehosteten Instanz
>    die nützlichste Sicherheitsmail, und die einzige, die einen Einbruch
>    sichtbar macht.
> 6. **Willkommensmail nach der ersten Anmeldung.** Optional, abschaltbar.

They read as two features and are one question asked twice: **is this browser
new to this account?** The first time there is nothing to compare against, and
that is the welcome; every time after there is, and that is the notice.

## Decisions

### A table, not a look at `sessions`

`sessions` already holds a `user_agent`, and the obvious implementation is to
ask whether any other live session has the same one. It is wrong in a way that
only shows up months later: **sessions expire and the maintenance job prunes
them**, so a browser somebody uses every few weeks becomes "new" again — and the
mail that exists to make an intrusion visible becomes the mail everybody
filters.

`known_devices` outlives the sessions it came from, which is the whole point.

### A hash, and what it is not

The user agent is stored hashed. Nothing needs to read it back, and the string
would make this table a list of what every person on the instance uses.

`sessions` says of its own copy: *"Not a fingerprint: truncated and never used
for authentication decisions."* That holds here and more narrowly — **nothing
reads this table to decide whether a request is allowed.** It decides whether to
send a courtesy mail, and an attacker who copies a user agent defeats it. The
letter says so, in its footer, because the alternative is somebody trusting it
to be more than it is.

### The insert is the decision

`ON CONFLICT DO NOTHING RETURNING` answers "was this known" and records it in one
statement. A read followed by a write has a gap in which a second sign-in slips
through and produces two letters about one device.

The count taken *before* it is what separates a welcome from a warning.

### The device is noted even when nobody is written to

No relay, no address on the account, welcome switched off — all of them still
record the browser. Forgetting it would mean a burst of letters about old
browsers on the day mail is configured, which is precisely the noise this whole
sequence of records has been avoiding.

### It says what was seen and does not guess a device name

"Firefox on Linux" is a guess parsed out of a string anybody can set, and a
wrong guess in a security notice is worse than none: the reader checks it against
what they know, finds it wrong, and dismisses a real warning. So the letter
carries the time, the coarse address, and the user agent as received.

That last one is this account's own data going to this account, and on a
self-hosted instance the person reading it is often the person who can act.

### Only from signing in, not from registering

Both sign-in paths note it — password, and the second-factor step that completes
one. Registering and accepting an invitation do not: there, "a browser you have
not used" is every browser, and the letter would be noise in somebody's first
minute.

### The welcome is the one mail with a switch, and it is off

Every other mail in this project is on because somebody needs it. A welcome is
the one nobody does: on an instance where an administrator makes accounts for
colleagues and tells them in person, it is a message about something they were
just told. The operator who wants it turns it on.

The notice beside it deliberately has no switch, and the setting's own hint says
so — because that one is the point.

## Consequences

**Ten tests**, and the ones that matter are about the second sign-in from the
same browser and about what is recorded when nothing is sent.

**The six proposed mails are done.** With ADR-0126, ADR-0128 and ADR-0129 this
closes the list written beside ADR-0121, and every one of them cost its
structure and nothing else — which was the point of building the letter first.

**English only**, still, for all of them. It is now the one thing left over from
this whole run of mail work, and it is a single change: the letters take a
locale already.

**A person cannot see their own devices.** The table exists and nothing lists
it, exactly as `/api/auth/sessions` is registered and not built. The notice is
useful without the list; the list is a screen, and screens are asked for.

## Alternatives considered

**Derive it from `sessions`.** No table, no migration, and a false alarm every
time somebody's session has expired since they last used that browser.

**Store the user agent, not a hash.** It would let a future screen show "Firefox
on Linux, first seen in March", which is a nicer list — of what everybody on the
instance uses, kept for ever, for a feature nobody asked for.

**Include the IP in the decision.** Far more sensitive: a person on a train
changes address every few minutes, and the notice would fire constantly and be
switched off within a week.

**Send on registration too.** The account's first sign-in is its registration on
most paths, and a "new device" mail one second after somebody chose a password
is a mail that teaches them this instance sends pointless mail.

**A welcome on by default.** Friendlier for the instance that wants it, and
noise for the one that does not — and the one that does not is the ordinary
self-hosted case this project is built for.
