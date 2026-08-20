# Architecture

The replay processing path uses a hexagonal boundary:

```text
Vite HTTP adapter
  -> ProcessReplay use case
    -> ReplayParser
    -> AnalysisProvider
    -> ReplayRepository

React application
  -> ReplayViewerController
    -> replay decoder -> replay timeline -> playback calculations
    -> ReplayProcessingGateway -> versioned HTTP API
    -> ReplayDataGateway -> raw replay HTTP resource

React renderer hosts
  -> CanvasReplayRenderer
  -> lazy React Three Fiber scene
```

`src/shared/contracts/replay-analysis-v2.ts` is the authoritative runtime and TypeScript definition for the public response. Types are inferred from Zod schemas rather than maintained separately. V2 adds structured per-player prediction samples to the public analysis.

`ProcessReplay` validates rrrocket output, requests analysis, creates a replay identity, validates the complete response, and publishes replay data only after all prior work succeeds. Goal and prediction infrastructure adapters run concurrently behind a composite analysis provider. Infrastructure owns executable paths, process behavior, temporary files, prose/JSON parsing, and filesystem storage.

The browser validates the same response schema. React renders the stable, model-neutral team analysis contract directly. Finding text is escaped by JSX, factual event relation controls event titles, finding tone controls styling, and navigation context is derived from each finding's `preRollSeconds`.

Replay IDs are opaque. Persistence stores metadata, validated analysis bundles, players, mistakes, and jobs in Supabase while parsed replay payloads remain private in R2; the database stores only the R2 object key. In production the browser uploads directly to a short-lived signed R2 URL, then the API sends the existing parser job to SQS. Job polling checks for Lambda outputs and claims a short finalization lease before validating and publishing them. No serverless invocation waits for analysis or continues after returning a response. Exact duplicate uploads are detected by a creator-scoped SHA-256 hash and return the existing bundle without rerunning analysis. Publication is one transactional RPC, and sustained disagreement findings are normalized for player history queries.

## Replay domain

`src/replay` is framework-independent. It owns the focused raw rrrocket DTO used by the viewer, browser validation assumptions, exact object-name adaptation, actor reconstruction, player/team association, snapshots, metadata and goal mapping, clocks/overtime, timeline bounds and lookup, source-time mapping, and interpolation. It must not import React, DOM, Canvas, Three.js, Vite, or transport code.

`rrrocket-adapter.ts` is the single compatibility point for parser-version assumptions. Object properties currently use exact rrrocket names. A parser change must be handled and tested there rather than compensated for in controllers or renderers.

Player lists use `team:name` keys. Car interpolation intentionally retains the legacy name-only lookup. Duplicate names on one team collapse in the list, and duplicate names across teams remain ambiguous during interpolation. This behavior is preserved until a stable rrrocket player identifier can be verified and migrated with explicit tests.

## Controller

`src/application/controllers/replay-viewer-controller.ts` owns loading/processing outcomes, metadata, analysis, playback, playhead, speed, view intent, tracked-player intent, interpolated replay state, and errors. It exposes `getSnapshot` and `subscribe` with a new frozen state object for every notified transition, so React can consume it through `useSyncExternalStore` without an adapter framework.

The controller depends only on replay-domain modules, shared response types, `ReplayProcessingGateway`, and `ReplayDataGateway`. HTTP implementations live in `src/adapters/http`; fetch and browser upload bodies never enter the controller.

`useReplayViewerController` is a thin `useSyncExternalStore` adapter. It subscribes and starts the initial load; it does not contain controller logic. React passes view models and callbacks to components. Components do not import concrete gateways, fetch data, parse replay/model responses, mutate state, or query global DOM nodes.

`FieldViewport` owns the active rendering lifecycle. The 2D adapter owns its canvas, animation loop, field drawing, and coordinate conversion. The lazy `ThreeReplayViewport` uses React Three Fiber for the 3D canvas and frame loop, and Drei for instanced cars, HTML labels, field edges, and orbit controls. Its scene owns arena geometry, car/ball visuals, pointer events, Auto Cam behavior, and replay-to-Three coordinate conversion. The R3F bundle is initialized only for 3D or Auto Cam and remains mounted when switching between those two modes.

Imperative 2D renderers implement `render`, `resize`, and `dispose`. React Three Fiber owns Three.js object, control, WebGL, and listener disposal when its canvas unmounts. Rendering code never orchestrates loading, upload, or analysis.

## Dependency rules

```text
main.tsx -> concrete HTTP gateways + controller -> React App
React App -> controller interface -> replay domain
FieldViewport -> Canvas 2D adapter / React Three Fiber + Drei
Server HTTP adapter -> application use case -> infrastructure ports

replay domain -/-> browser, rendering, transport, React
controller -/-> browser, rendering, transport details, React
components -/-> fetch, rrrocket parsing, model parsing, concrete gateways
renderers -/-> application orchestration
```
