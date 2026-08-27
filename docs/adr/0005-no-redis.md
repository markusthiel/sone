# ADR-0005: Postgres LISTEN/NOTIFY instead of Redis

- **Status:** Accepted
- **Date:** 2026-08-27

## Context

Multiple server instances must learn about document updates produced by their
peers. The reflexive answer is Redis pub/sub. Comparable projects (AFFiNE,
AppFlowy) require Postgres *and* Redis.

Every additional required process is a real cost in a self-hosted product: one
more thing to configure, monitor, back up, upgrade and get wrong.

## Decision

Postgres `LISTEN/NOTIFY` for inter-instance messaging. A trigger on
`doc_updates` publishes to the `sone_doc_update` channel. No Redis.

## Consequences

The minimum deployment is one application container plus Postgres. That is a
genuine differentiator and should be stated on the project page.

`NOTIFY` payloads are capped at 8000 bytes, so messages carry ids only, never
document content — which is the right design regardless.

`NOTIFY` is not durable: a listener that is down misses messages. Instances
must therefore reconcile on connect by comparing sequence numbers, not rely on
the notification alone. This is required for correctness anyway, since a
notification can be lost on any transport.

Beyond roughly a few hundred concurrent editing sessions per instance this may
need revisiting. That threshold is far outside the target deployment size, and
a Redis adapter can be added behind the same interface without a format change.

## Alternatives considered

**Redis pub/sub.** Rejected on operational cost, not capability.

**NATS.** Same objection, less ubiquity.
