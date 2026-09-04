# ADR-0065: Requiring a second factor

## Status

Accepted. The rule, the gate and the setting are built; the banner, the two
mails and the enrolment-only screen are not.

## Context

[ADR-0063](0063-second-factor.md) built second factors and left this undecided,
with the reason stated: "An administrator being able to say 'everybody here must
have one' is reasonable and is a policy question — what happens to somebody who
has not enrolled, whether they can still read, how long they get. None of that
is decided by adding a flag."

This record answers those three questions. They are the feature; the flag is
half an hour.

## Decisions

### An administrator cannot require what they do not have

Switching it on is refused unless the administrator doing it has a confirmed
second factor themselves.

Not paternalism — a policy imposed by somebody exempt from it is a policy that
gets rolled back the first time it inconveniences the person who set it. It also
means whoever turns it on has walked the enrolment path and knows what they are
asking of everybody else.

### Nobody is locked out on the day it is switched on

Fourteen days of grace, counted from the moment it was enabled and stored with
the setting rather than computed from anything else.

An instance that locks out everybody who happened to be on holiday is an
instance whose administrator spends a week removing factors by hand — and each
of those removals is the exact act the feature exists to prevent, done under
pressure. A deadline with warning produces enrolments; a wall produces support
tickets and exceptions.

### During the grace period everything works, and everybody is told

Signing in, reading, writing: unchanged. There is a banner and one mail when the
requirement is switched on, and another mail three days before the deadline.

Two mails and not five. A feature that mails somebody daily about a thing they
have decided to do at the weekend has taught them to filter it.

### After the deadline, signing in leads only to enrolment

The password still works and the session is still created — and every screen
except enrolment redirects to enrolment. Reading is **not** allowed.

The alternative, letting people read but not write, was considered and refused:
the point of a second factor is that a stolen password grants nothing, and a
stolen password that grants read access to a company's notes has granted the
thing that mattered.

### Single sign-on accounts are exempt, and it is said out loud

An OIDC account has no password here; it authenticates at the provider, which
has its own second factor and is the right place for one. Requiring TOTP of such
an account would be requiring a second factor on top of somebody else's first
one.

The administration screen says this next to the setting, because an
administrator who turns it on and sees half their people unaffected will
otherwise assume it is broken.

### Turning it off changes nothing about existing factors

They stay, and stay usable. A requirement that removed second factors when
lifted would be a switch that reduces security when flipped in the safe
direction.

## Consequences

Two settings — whether, and since when — a check in the session-resolving path,
a banner, two mails, and a screen that refuses to be anything but enrolment.

The check runs on every authenticated request, so it has to be cheap: it is a
boolean on the instance settings and one already-loaded fact about the account.

## Built so far

The rule as one function taking facts the caller already has, and the gate at
`requireSession` — the one place every authenticated request passes. **Route by
route it would be a rule with a hole in it the day somebody adds a route**, and
the gate returns immediately when the requirement is off, because a check on
every request has to be free when the feature is not in use.

It is *installed* by the server rather than imported by the auth module: every
module uses `requireSession`, and having it reach into the settings store would
make half the codebase depend on it. A test that registers routes by hand gets
no gate, which is the behaviour of an instance that requires nothing.

Two things the tests pinned down that would otherwise have gone wrong:

**A broken `since` gives grace, not a lockout.** An unparseable timestamp is
read as *now*, so the worst a corrupted setting costs is fourteen more days —
where reading it as "long ago" would lock out an entire instance over a bad
string.

**Saving an unrelated setting does not restart the clock.** The timestamp is
stamped only on the transition from off to on, and a `requireSecondFactorSince`
sent by a client is discarded. Otherwise every settings save would quietly hand
everybody another fortnight.

## What is deliberately not decided

**A per-workspace requirement.** Workspaces are not security boundaries in the
way this would need — somebody is a member of several, and a factor is a property
of the account. "Required in this workspace" would mean a person who is required
and not required at the same time.

**Requiring it of guests.** A share link has no account, so there is nothing to
enrol. Whether a *link* should be able to demand a second factor is a different
feature and a strange one.

**An administrator-set deadline.** Fourteen days is a decision rather than a
default; making it a field means every operator has to have an opinion about a
number, and the ones who would lower it to zero are the ones this record's second
decision is about.
