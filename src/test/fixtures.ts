export const replayData = {
  properties: {}, objects: [], names: [],
  network_frames: { frames: [{ time: 0, new_actors: [], updated_actors: [], deleted_actors: [] }] },
};

export function validBundle() {
  return {
    schemaVersion: 2 as const,
    replay: {
      id: "opaque-id",
      filename: "match.replay",
      dataUrl: "/api/replays/opaque-id/data",
      timebase: { unit: "seconds" as const, origin: "replay-start" as const },
    },
    analysis: {
      provider: "fixture",
      generatedAt: "2026-08-17T12:00:00.000Z",
      teams: [{
        id: "blue",
        team: { id: "blue" as const, displayName: "Blue" },
        players: [{ displayName: "Alpha" }],
        score: { for: 1, against: 0 },
        events: [{
          id: "blue-scored-1",
          relation: "scored" as const,
          ordinal: 1,
          occurredAtSeconds: 12.5,
          findings: [{
            id: "finding-1",
            kind: "contribution" as const,
            tone: "positive" as const,
            text: "Alpha finished the play.",
          }],
        }],
      }],
      playerPredictions: {
        sampleIntervalSeconds: 0.5,
        players: [{
          id: "player-1",
          displayName: "Alpha",
          team: "blue" as const,
          samples: [{
            anchorSeconds: 12.5,
            status: "available" as const,
            horizons: [{
              window: { startSeconds: 0, endSeconds: 1 },
              targetSeconds: 13.5,
              position: { x: 100, y: -200, z: 17 },
              forward: { x: 1, y: 0, z: 0 },
            }],
          }],
        }],
      },
    },
  };
}
