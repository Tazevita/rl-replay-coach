import { describe, expect, it } from "vitest";
import { buildSnapshots } from "./decoder";
import { RRROCKET_OBJECT_NAMES } from "./rrrocket-adapter";
import type { RawReplayFrame, RawRrrocketReplay } from "./types";

const objects = [
  RRROCKET_OBJECT_NAMES.rigidBody,
  RRROCKET_OBJECT_NAMES.playerReplication,
  RRROCKET_OBJECT_NAMES.playerName,
  RRROCKET_OBJECT_NAMES.playerTeam,
  RRROCKET_OBJECT_NAMES.secondsRemaining,
  RRROCKET_OBJECT_NAMES.overtime,
  RRROCKET_OBJECT_NAMES.gameState,
  RRROCKET_OBJECT_NAMES.ball,
  RRROCKET_OBJECT_NAMES.car,
  RRROCKET_OBJECT_NAMES.blueTeam,
  RRROCKET_OBJECT_NAMES.orangeTeam,
  "TAGame.Default__PRI_TA",
];

function replay(frames: RawReplayFrame[]): RawRrrocketReplay {
  return { properties: {}, objects, names: ["Inactive", "Active"], network_frames: { frames } };
}

describe("buildSnapshots", () => {
  it("handles an empty replay", () => {
    expect(buildSnapshots(replay([]))).toEqual([]);
  });

  it("reconstructs actors, player/team association, ball, clocks, overtime, and deletion", () => {
    const snapshots = buildSnapshots(replay([
      {
        time: 10,
        new_actors: [
          { actor_id: 100, object_id: 9 },
          { actor_id: 200, object_id: 11 },
          { actor_id: 300, object_id: 8 },
          { actor_id: 400, object_id: 7, initial_trajectory: { location: { x: 1, y: 2, z: 3 } } },
        ],
        updated_actors: [
          { actor_id: 200, object_id: 2, attribute: { String: "Alpha" } },
          { actor_id: 200, object_id: 3, attribute: { ActiveActor: { active: true, actor: 100 } } },
          { actor_id: 300, object_id: 1, attribute: { ActiveActor: { active: true, actor: 200 } } },
          { actor_id: 300, object_id: 0, attribute: { RigidBody: { location: { x: 10, y: 20, z: 30 }, rotation: { x: 0, y: 0, z: 0, w: 1 } } } },
          { actor_id: 999, object_id: 4, attribute: { Int: 3 } },
          { actor_id: 999, object_id: 6, attribute: { Name: 1 } },
        ],
        deleted_actors: [],
      },
      {
        time: 11,
        new_actors: [],
        updated_actors: [{ actor_id: 999, object_id: 5, attribute: { Boolean: true } }],
        deleted_actors: [],
      },
      { time: 12.5, new_actors: [], updated_actors: [], deleted_actors: [300, 400] },
    ]));

    expect(snapshots[0]).toMatchObject({ time: 10, sourceTime: 10, secondsRemaining: 3, overtime: false });
    expect(snapshots[0].cars).toEqual([expect.objectContaining({ id: 300, name: "Alpha", team: 0, x: 10, y: 20, z: 30 })]);
    expect(snapshots[0].ball).toEqual({ x: 1, y: 2, z: 3 });
    expect(snapshots[1]).toMatchObject({ overtime: true, overtimeElapsed: 0 });
    expect(snapshots[2]).toMatchObject({ overtime: true, overtimeElapsed: 1.5, cars: [], ball: null });
  });

  it("defaults missing player names and teams without inventing a car without PRI data", () => {
    const snapshots = buildSnapshots(replay([{
      time: 0,
      new_actors: [
        { actor_id: 1, object_id: 11 },
        { actor_id: 2, object_id: 8, initial_trajectory: { location: { x: 0, y: 0, z: 0 } } },
        { actor_id: 3, object_id: 8, initial_trajectory: { location: { x: 1, y: 1, z: 1 } } },
      ],
      updated_actors: [{ actor_id: 2, object_id: 1, attribute: { ActiveActor: { active: true, actor: 1 } } }],
      deleted_actors: [],
    }]));
    expect(snapshots[0].cars).toEqual([expect.objectContaining({ name: "Player", team: 0 })]);
  });
});
