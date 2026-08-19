# ADR 0002: Versioned Replay Analysis API

## Status

Accepted.

## Decision

`POST /api/replays` returns `ReplayAnalysisBundleV2` with `schemaVersion: 2`, an opaque replay identity, a replay-scoped data URL, an explicit seconds-from-replay-start timebase, model-neutral team analysis, and structured player predictions. V2 replaces V1; no compatibility alias is retained.

Successful server responses and browser inputs are validated with the same authoritative Zod schema. Public responses never expose local paths. Human-readable model prose remains fallback finding text; optional evidence carries safely parsed structure.

## Consequences

Replay data and analysis cannot be accidentally paired across uploads. Contract changes require an explicit versioning decision. The React UI consumes this contract directly; no legacy presentation bridge remains.
