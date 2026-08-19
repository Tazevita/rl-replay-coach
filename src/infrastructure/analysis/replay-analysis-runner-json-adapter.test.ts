import { describe, expect, it } from "vitest";
import { ReplayAnalysisRunnerJsonAdapter } from "./replay-analysis-runner-json-adapter";

const team = {
  id: "blue",
  team: { id: "blue", displayName: "Blue" },
  players: [{ id: "alpha", displayName: "Alpha" }, { id: "beta", displayName: "Beta" }],
  score: { for: 1, against: 0 },
  events: [{
    id: "blue-scored-1",
    relation: "scored",
    ordinal: 1,
    occurredAtSeconds: 13,
    displayClock: "00:13",
    findings: [{
      id: "blue-scored-1-finding-1",
      kind: "contribution",
      tone: "positive",
      text: "Alpha: finish; made the likely final touch before the goal",
      subject: { playerId: "alpha", displayName: "Alpha" },
      navigation: { anchorSeconds: 12.5, preRollSeconds: 3 },
      evidence: { role: "FINISH" },
    }],
  }],
};

const playerPredictions = {
  sampleIntervalSeconds: 1,
  players: [],
};

describe("replay analysis runner JSON adaptation", () => {
  it("runs one combined analysis and validates its structured output", async () => {
    const calls: string[][] = [];
    const adapter = new ReplayAnalysisRunnerJsonAdapter({
      python: "python", module: "replay_analysis_service", cwd: "/model",
      device: "cpu",
      run: async request => {
        calls.push(request.args);
        return JSON.stringify({ schemaVersion: 1, teams: [team], playerPredictions });
      },
    });
    const result = await adapter.analyze("/tmp/replay.json");
    expect(calls).toEqual([[
      "-m", "replay_analysis_service", "/tmp/replay.json", "--all-teams",
      "--prediction-interval", "1", "--device", "cpu",
    ]]);
    expect(result).toEqual({
      provider: "replay-analysis-runner-json",
      modelVersion: undefined,
      teams: [team],
      playerPredictions,
    });
  });

  it("rejects malformed runner output instead of recovering from prose", async () => {
    const adapter = new ReplayAnalysisRunnerJsonAdapter({
      python: "python", module: "replay_analysis_service", cwd: "/model",
      run: async () => "not JSON",
    });
    await expect(adapter.analyze("/tmp/replay.json")).rejects.toThrow(
      "Replay analysis runner returned malformed JSON.",
    );
  });
});
