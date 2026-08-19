# ADR 0001: Hexagonal Boundaries

## Status

Accepted.

## Decision

Vite is an HTTP adapter only. `ProcessReplay` coordinates the use case through `ReplayParser`, `AnalysisProvider`, and `ReplayRepository` ports. Process execution, temporary files, stdout parsing, and concrete storage remain in infrastructure.

The browser accesses processing through `ReplayProcessingGateway`. Shared Zod schemas define and validate the boundary in both environments.

## Consequences

External tools and storage can be replaced without changing orchestration or the public contract. Tests use fake ports and do not need the sibling model repository. React consumes the controller and stable analysis contract without importing infrastructure.
