import type { RawRrrocketReplay } from "../replay/types";
import { RRROCKET_OBJECT_NAMES } from "../replay/rrrocket-adapter";

export function smallReplayFixture(): RawRrrocketReplay {
  return {
    properties: {
      MapName: "DFH Stadium",
      MatchType: "Soccar",
      Team0Score: 1,
      Team1Score: 0,
      Goals: [{ frame: 1, PlayerName: "Alpha", PlayerTeam: 0 }],
    },
    objects: [
      RRROCKET_OBJECT_NAMES.rigidBody,
      RRROCKET_OBJECT_NAMES.playerReplication,
      RRROCKET_OBJECT_NAMES.playerName,
      RRROCKET_OBJECT_NAMES.playerTeam,
      RRROCKET_OBJECT_NAMES.car,
      RRROCKET_OBJECT_NAMES.blueTeam,
      "TAGame.Default__PRI_TA",
    ],
    names: [],
    network_frames: {
      frames: [0, 5, 10, 15].map(time => ({
        time,
        new_actors: time === 0 ? [
          { actor_id: 100, object_id: 5 },
          { actor_id: 200, object_id: 6 },
          { actor_id: 300, object_id: 4, initial_trajectory: { location: { x: 0, y: 0, z: 17 } } },
        ] : [],
        updated_actors: time === 0 ? [
          { actor_id: 200, object_id: 2, attribute: { String: "Alpha" } },
          { actor_id: 200, object_id: 3, attribute: { ActiveActor: { active: true, actor: 100 } } },
          { actor_id: 300, object_id: 1, attribute: { ActiveActor: { active: true, actor: 200 } } },
        ] : [],
        deleted_actors: [],
      })),
    },
  };
}
