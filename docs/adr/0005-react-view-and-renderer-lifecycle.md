# ADR 0005: React View and Renderer Lifecycle

## Status

Accepted.

## Decision

React owns browser presentation and lifecycle. It subscribes to the framework-independent `ReplayViewerController` through `useSyncExternalStore`, passes state and callbacks into presentational components, and owns animation and keyboard listener cleanup.

Canvas 2D lives in an imperative rendering adapter supplied with a React-mounted host. The 3D view is a lazy React Three Fiber scene using Drei controls, instances, labels, and helpers. Each rendering path owns its graphics resources, coordinate conversion, frame loop, camera behavior, resize behavior, and disposal.

## Consequences

Components can be tested without HTTP, rrrocket, Python, WebGL, or the model executable. Controller and domain behavior remain reusable outside React. React Three Fiber disposes the 3D scene on unmount; the 2D adapter retains explicit disposal. Application orchestration cannot move into either rendering path.
