import { describe, expect, it } from "vitest";
import { deriveReplayMetadata, formatGameClock } from "./metadata";
import {
  clampTime,
  createReplayTimeline,
  findSnapshotIndex,
  interpolateAngle,
  interpolateRotation,
  listReplayPlayers,
  nearestSourceTime,
  replayActorKey,
  replayStateAt,
} from "./timeline";
import type { ReplayCar, ReplaySnapshot } from "./types";

function car(overrides: Partial<ReplayCar> = {}): ReplayCar {
  return { id: 1, name: "Alpha", team: 0, x: 0, y: 0, z: 0, yaw: 0, rotation: { x: 0, y: 0, z: 0, w: 1 }, ...overrides };
}

function frame(time: number, overrides: Partial<ReplaySnapshot> = {}): ReplaySnapshot {
  return { time, sourceTime: time + 100, frameIndex: time * 10, cars: [], ball: null, secondsRemaining: null, overtime: false, overtimeElapsed: 0, ...overrides };
}

describe("replay timeline", () => {
  it("safely handles empty, single-frame, and zero-duration timelines", () => {
    const empty = createReplayTimeline([]);
    expect(empty).toMatchObject({ startTime: 0, endTime: 0, duration: 0 });
    expect(findSnapshotIndex(empty, 3)).toBe(-1);
    expect(replayStateAt(empty, 3)).toEqual({ cars: [], ball: null, frameIndex: 0 });

    const single = createReplayTimeline([frame(4)]);
    expect(single.duration).toBe(0);
    expect(clampTime(single, 99)).toBe(4);
    expect(replayStateAt(single, 99).frameIndex).toBe(40);
  });

  it("performs binary lookup at start, middle, and end and clamps seeks", () => {
    const timeline = createReplayTimeline([frame(10), frame(11), frame(12)]);
    expect([findSnapshotIndex(timeline, 10), findSnapshotIndex(timeline, 11.5), findSnapshotIndex(timeline, 20)]).toEqual([0, 1, 2]);
    expect([clampTime(timeline, 0), clampTime(timeline, 11), clampTime(timeline, 20)]).toEqual([10, 11, 12]);
  });

  it("preserves source time and selects the nearest source frame", () => {
    const timeline = createReplayTimeline([frame(3, { sourceTime: 40 }), frame(4, { sourceTime: 50 }), frame(5, { sourceTime: 80 })]);
    expect(timeline.snapshots[1]).toMatchObject({ time: 4, sourceTime: 50 });
    expect(nearestSourceTime(timeline, 72)).toBe(5);
    expect(nearestSourceTime(timeline, 54)).toBe(4);
  });

  it("interpolates ball and car transforms across short held samples", () => {
    const timeline = createReplayTimeline([
      frame(0, { cars: [car()], ball: { x: 0, y: 0, z: 0 } }),
      frame(.1, { cars: [car()], ball: { x: 0, y: 0, z: 0 } }),
      frame(.2, { cars: [car({ x: 20, y: 10, z: 4 })], ball: { x: 10, y: 20, z: 30 } }),
    ]);
    expect(replayStateAt(timeline, .1)).toMatchObject({
      cars: [{ x: 10, y: 5, z: 2 }],
      ball: { x: 5, y: 10, z: 15 },
    });
  });

  it("interpolates cars by actor id when players have the same name", () => {
    const timeline = createReplayTimeline([
      frame(0, { cars: [car(), car({ id: 2, x: 100 })] }),
      frame(.1, { cars: [car(), car({ id: 2, x: 100 })] }),
      frame(.2, { cars: [car({ x: 20 }), car({ id: 2, x: 140 })] }),
    ]);
    expect(replayStateAt(timeline, .1).cars.map(value => value.x)).toEqual([10, 120]);
  });

  it("interpolates yaw-only rotation updates", () => {
    const timeline = createReplayTimeline([
      frame(0, { cars: [car({ rotation: null, yaw: 0 })] }),
      frame(.1, { cars: [car({ rotation: null, yaw: 0 })] }),
      frame(.2, { cars: [car({ rotation: null, yaw: 1 })] }),
    ]);
    expect(replayStateAt(timeline, .1).cars[0].yaw).toBeCloseTo(.5);
  });

  it("does not interpolate transform gaps greater than the legacy threshold", () => {
    const timeline = createReplayTimeline([
      frame(0, { cars: [car()], ball: { x: 0, y: 0, z: 0 } }),
      frame(.3, { cars: [car({ x: 10 })], ball: { x: 10, y: 0, z: 0 } }),
    ]);
    expect(replayStateAt(timeline, .15)).toMatchObject({ cars: [{ x: 0 }], ball: { x: 0 } });
  });

  it("takes the shortest angle path and performs pure quaternion slerp", () => {
    const angle = interpolateAngle(Math.PI - .1, -Math.PI + .1, .5);
    expect(Math.abs(Math.abs(angle) - Math.PI)).toBeLessThan(1e-10);
    const rotation = interpolateRotation({ x: 0, y: 0, z: 0, w: 1 }, { x: 0, y: 0, z: 1, w: 0 }, .5)!;
    expect(rotation.z).toBeCloseTo(Math.SQRT1_2);
    expect(rotation.w).toBeCloseTo(Math.SQRT1_2);
  });

  it("lists players by team/name while retaining duplicate-name ambiguity across teams", () => {
    const timeline = createReplayTimeline([frame(0, { cars: [car(), car({ id: 2, team: 1 }), car()] })]);
    expect(listReplayPlayers(timeline)).toEqual([
      { key: "0:Alpha", name: "Alpha", team: 0 },
      { key: "1:Alpha", name: "Alpha", team: 1 },
    ]);
  });

  it("distinguishes reused actor ids by player identity", () => {
    expect(replayActorKey(car({ id: 52, name: "Lucca", team: 1 }))).toBe("52:1:Lucca");
    expect(replayActorKey(car({ id: 52, name: "Tazevita", team: 0 }))).toBe("52:0:Tazevita");
  });
});

describe("replay presentation data", () => {
  it("maps goals to clamped frame times and handles a zero-duration replay", () => {
    const snapshots = [frame(5)];
    const metadata = deriveReplayMetadata({
      properties: { MapName: "DFH", MatchType: "Ranked", Team0Score: 1, Goals: [{ frame: 99, PlayerName: "Alpha", PlayerTeam: 0 }] },
      objects: [], names: [], network_frames: { frames: [] },
    }, snapshots);
    expect(metadata).toMatchObject({ mapName: "DFH", matchType: "Ranked", blueScore: 1, orangeScore: 0, duration: 0 });
    expect(metadata.goals[0]).toMatchObject({ time: 5, elapsed: 0, playerName: "Alpha", playerTeam: 0 });
  });

  it("formats regulation and overtime clocks", () => {
    expect(formatGameClock(frame(0, { secondsRemaining: 61 }))).toBe("1:01");
    expect(formatGameClock(frame(0, { overtime: true, overtimeElapsed: 4.9 }))).toBe("OT +0:04");
    expect(formatGameClock(undefined)).toBe("--:--");
  });
});
