# ADR-0003: No end-to-end encryption

- **Status:** Accepted
- **Date:** 2026-08-27

## Context

End-to-end encryption and server-side querying are mutually exclusive. If the
server only sees opaque Yjs updates, it cannot search, cannot enforce
permissions below the document boundary, cannot serve a web client without a
full sync, and cannot resolve share links without workarounds.

The stated priorities for SONE are a web portal, full-text search across the
workspace, guest users, and shareable links with edit rights.

## Decision

No end-to-end encryption. The server can read document content.

Encryption at rest is an operator concern (disk or volume level), documented
in the deployment guide, not a property of the application format.

## Consequences

Full-text search over everything, a real web client, granular per-page
permissions and anonymous link editing all become straightforward.

The operator of a SONE instance can read the content. For self-hosting this is
usually acceptable — the operator is the organisation itself — but it must be
stated plainly in the README rather than implied away. A hosted SONE offering,
should one ever exist, would carry the same caveat.

This decision is effectively irreversible once documents exist: retrofitting
E2EE would mean rebuilding search, permissions and the web client.

## Alternatives considered

**Full E2EE.** Rejected against the stated priorities.

**Encrypt document bodies, leave metadata in clear.** Considered seriously.
Titles, ids and collection structure stay readable so navigation and
permissions work server-side, while bodies stay private. Rejected because it
still forecloses full-text search, which was ranked higher than
confidentiality against the operator.
