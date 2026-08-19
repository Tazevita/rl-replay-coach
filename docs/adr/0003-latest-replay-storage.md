# ADR 0003: Latest Replay Storage

## Status

Superseded by durable Supabase replay storage.

## Decision

Latest-only storage is intentional for now. Replay IDs are still required to prevent replay/analysis mismatches. A successful upload supersedes the prior replay, and requests using superseded or unknown IDs return 404.

Replay IDs and availability are process-session scoped. Persistence and replay history will be implemented later behind `ReplayRepository`. Replacing storage must not change the public API.

## Consequences

The implementation has minimal storage and lifecycle complexity but cannot browse old uploads or survive a process restart. Publication occurs only after parsing and analysis completely succeed.
