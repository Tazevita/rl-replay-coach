# ADR 0004: Pure quaternion interpolation

## Status

Accepted.

## Decision

Replay interpolation implements normalized shortest-path quaternion slerp in `src/replay/timeline.ts`. It negates the second quaternion when the dot product is negative, uses normalized linear interpolation for nearly parallel inputs, and treats a zero quaternion as identity.

## Rationale

Quaternion interpolation is replay-domain behavior, while Three.js is a rendering dependency. Keeping the small calculation in the domain makes playback deterministic in tests and usable by React or non-Three.js renderers. The algorithm matches the prior normalized `THREE.Quaternion.slerp` behavior for valid replay rotations without importing Three.js.
