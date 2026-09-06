# ADR-0105: The key the archive was sealed under

## Status

Accepted. Built. From the "named but not built" list in
`claude/durchgang-nie-gelaufen.md` — checked first, like the last four rounds,
and this one was true.

## Context

`SONE_SECRET_KEY` lives in the environment and is deliberately not in the
archive. Three things are sealed with it and stored in the database:

- **share tokens** — AES-256-GCM under an HKDF-derived key (`shareTokenStore`)
- **second-factor secrets** — encrypted the same way (`totp`)
- **mail reply tokens** — HMAC-signed (`replyToken`)

A restore verified the format version, the dump checksum, the file-archive
checksum and that the target database was empty. It did not verify that the
instance doing the restoring holds the key the data was sealed under.

So a restore onto a host where somebody forgot to copy the key **succeeded**.
The database came back whole. And then:

```ts
export function decryptShareToken(stored: Buffer, secret: string): string | null {
  …
  } catch {
    return null;
```

`null`, not a throw — on purpose, because a stored value that will not decrypt
is a link that does not resolve. Under the wrong key that is every link, and it
is **indistinguishable from a link that was never made.** No error, no log line,
nothing to correlate with the restore that caused it. Second factors and mail
replies fail the same way, one account at a time, over weeks.

`docs/deployment.md` described this exactly:

> Restoring with a *different* `SONE_SECRET_KEY` succeeds and then quietly fails
> to read anything sealed with the old one — second factors and share links stop
> working, one account at a time, with no error.

The record was accurate, prominent, and enforced by nothing. That is a variant
of a pattern this repository has now named five times, and the sharpest one yet:
usually the record describes what *should* have been built and reads as though
it was. Here it correctly describes a defect and simply lives beside it.

## Decisions

### The manifest records which key, never the key

```
secretKeyFingerprint: hkdf-sha256(SONE_SECRET_KEY, info='sone/backup/key-fingerprint/v1')
```

HKDF with a purpose string of its own, so this value and the one
`shareTokenStore` derives for encryption are independent: holding this one says
nothing about that one. No salt, for the reason `keyFrom` already gives — the
secret is high-entropy by configuration, `loadConfig` refusing anything under 32
characters, and a salt would have to be stored beside the value it protects.

The archive contains the whole database, so the only thing worth protecting here
is the key itself, and a one-way function of it is not the key. A test asserts
the key does not appear anywhere in the manifest.

### `secretKey` is required, not optional

Adding it as an optional field would have let every existing caller go on
writing archives that cannot say which key sealed them — which is the state
being fixed. Required, so the compiler names every call site; it named
twenty-two, all in one test file plus the two CLI scripts.

This is the file's own rule applied to a second field: *"a backup that omits
things is only allowed to do so on purpose"*, which is what the file-storage
branch was rewritten for (ADR-0079).

### Three states, three answers

| | |
|---|---|
| sealed under this key | proceed, silently |
| sealed under another | **refuse**, before anything is touched |
| archive too old to say | proceed, and say it could not be checked |

The third is the same distinction `fileStorage` exists for: *"not checked" and
"checked and fine" are different answers.* An archive written before this field
still restores — refusing it would turn a missing check into a lost backup.

The refusal sits beside the checksum verification, in the block whose whole
purpose is to fail before touching anything: a wrong key discovered after the
restore is a database that came back whole and silently lost three things.

### The message names what breaks

Whoever sees the refusal is the one person who can still go and find the old
key, and in five minutes they will not remember which three things stop working.
So the error says: every share link, every second factor, every mail reply
token; set `SONE_SECRET_KEY` to what the backed-up instance used; and, if that
key is genuinely gone, `--different-key` proceeds and accepts the loss.

### `--different-key`, not `--force`

Two different risks. `--force` skips the "target is not empty" refusal and its
documentation is careful to say what it does *not* do. One flag answering both
is one flag people pass without reading either.

## Consequences

**Six tests, four failing before the change.** The two that pass are the ones
that must: *the right key restores without a word about it* — a check that fires
on the ordinary case is a check somebody turns off — and the demonstration that
the damage is real, which is the only thing that makes the refusal worth having:

```ts
assert.equal(decryptShareToken(sealed, KEY_A), 'a-share-token-worth-keeping');
assert.equal(decryptShareToken(sealed, KEY_B), null, 'and not a word about it');
```

**`docs/deployment.md` no longer describes a defect as a fact of life.** The
paragraph that warned about this now says the restore refuses it, and documents
the flag and the older-archive case.

**Restores of existing archives are unaffected** and say so. Every archive
written before this build lacks the field and produces a warning rather than a
refusal, which is the only behaviour that does not punish somebody for having
taken a backup earlier.

## What else that list said, and what was true

The open-points list in `claude/durchgang-nie-gelaufen.md` named seven things.
Checked before acting, as ADR-0101 through ADR-0104 all had to learn:

- **"Linking an existing account to a provider does not exist. Anyone who
  already had an account cannot use SSO at all."** — **Stale.** ADR-0084 built
  it: `?link=1`, a callback that re-checks the session, `GET`/`DELETE` on
  `/api/auth/oidc/link`, a button in settings, and five tests.
- **"`writeNotifications` has no database test."** — **Wrong in its
  conclusion.** It is exercised against a database through the projection in
  `mentionReachesInbox.db.test.ts` and `bellPush.db.test.ts`. The real gap is
  narrower and different: the membership-and-visibility half of its INSERT has
  no test naming a non-member or a restricted page.
- **"`versionQuietDocuments` and `pruneShareSessions` have never been executed
  by a test; two of the ten maintenance tasks never run."** — **Wrong.** Both
  run in five database-backed tests. What is true is that nothing *asserts*
  their results, and that one task — revalidating connections — is a no-op under
  test because no test passes a `sync`.
- **Purge leftovers, the file orphan sweep, the key fingerprint, the OIDC
  small stuff** — all four true.

Fourth round running in which an open-points list disagreed with the code, and
the first in which most of it held. Three of seven wrong is still three of
seven.

## Alternatives considered

**Store a hash of the key with no HKDF purpose string.** `sha256(key)` would
work as an identifier and shares an input with nothing — but it invites the next
person to compare it against some other hash of the same key. A purpose string
costs nothing and makes the independence explicit.

**Encrypt a known plaintext and store the ciphertext**, verifying by decrypting.
Proves the key can actually decrypt rather than merely matching, which sounds
stronger and is not: the derivation is deterministic, so equal fingerprints and
successful decryption are the same fact, and this version adds a second
ciphertext format to keep working.

**Warn instead of refusing.** A warning on a restore is read by somebody at
2 a.m. who is already relieved the command exited zero. The failure this
prevents is discovered weeks later by a person who cannot connect it to
anything.

**Check at startup instead of at restore.** The server would have to notice that
*some* sealed values no longer decrypt, which is indistinguishable from links
that were revoked. The restore is the one moment where the question has a
definite answer.

**Put the key in the archive so a restore always works.** Then the backup — the
thing that gets copied to a laptop, a bucket, a colleague's disk — contains the
key that decrypts everything in it. `docs/deployment.md` says why not, and it is
the reason the fingerprint is one-way.
