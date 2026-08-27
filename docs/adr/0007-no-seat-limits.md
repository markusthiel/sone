# ADR-0007: No seat limits, feature gates or licence checks

- **Status:** Accepted
- **Date:** 2026-08-27

## Context

SONE exists because of a specific experience. AppFlowy is AGPL-3.0 licensed,
yet its self-hosted server refuses the second user: the startup log reports
free-plan limits of one user and three guests, and the second login simply
fails. The limit is not documented in the self-hosting guide, so operators
debug their own configuration for hours before finding it.

The licence was open. The product was not.

## Decision

SONE contains no user limit, no seat counting, no licence key check, no
feature flag whose purpose is to withhold functionality from self-hosters, and
no "enterprise edition" of the codebase. AGPL-3.0, one edition, everything in
the repository.

This ADR is normative for contributions. A pull request introducing any of the
above is rejected on principle, not on implementation quality.

## Consequences

Whatever revenue model SONE may eventually have — support, hosting,
consulting, sponsored development — it cannot be built on withholding
functionality from the self-hosted build. That is a real constraint accepted
deliberately.

The schema has no seat-count column and should never gain one. `page_search`,
`workspace_members` and `share_tokens` are all unbounded by design.

If this project is ever transferred or acquired, this ADR is the record of
intent. AGPL-3.0 means existing releases stay free regardless of what a future
owner decides.

## Alternatives considered

**Open core with a paid enterprise tier.** The industry norm. Rejected: it is
the exact thing SONE was created in reaction to.

**Soft limits with a nag screen.** Rejected. Same category, worse taste.
