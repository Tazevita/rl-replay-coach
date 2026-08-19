import { describe, expect, it, vi } from "vitest";
import { PredictionRunnerJsonAdapter } from "./prediction-runner-json-adapter";

const runnerOutput = {
  schemaVersion: 1,
  sampleIntervalSeconds: 0.5,
  players: [{
    id: "player-1",
    displayName: "Alpha",
    team: "blue",
    samples: [{
      anchorSeconds: 2,
      status: "available",
      horizons: [{
        window: { startSeconds: 0, endSeconds: 1 },
        targetSeconds: 3,
        position: { x: 1, y: 2, z: 3 },
        forward: { x: 0, y: 1, z: 0 },
      }],
    }],
  }],
};

describe("PredictionRunnerJsonAdapter", () => {
  it("invokes the runner in JSON mode and returns the public collection", async () => {
    const run = vi.fn(async () => JSON.stringify(runnerOutput));
    const adapter = new PredictionRunnerJsonAdapter({
      python: "/model/.venv/bin/python",
      script: "/model/replay-intent-runner/run_replay.py",
      cwd: "/model",
      run,
    });

    const result = await adapter.predictPlayers("/tmp/parsed-replay.json");

    expect(run).toHaveBeenCalledWith({
      command: "/model/.venv/bin/python",
      args: ["/model/replay-intent-runner/run_replay.py", "/tmp/parsed-replay.json", "--format", "json"],
      cwd: "/model",
    });
    expect(result.provider).toBe("prediction-runner-json");
    expect(result.playerPredictions).toEqual({
      sampleIntervalSeconds: runnerOutput.sampleIntervalSeconds,
      players: runnerOutput.players,
    });
    expect(result.playerPredictions).not.toHaveProperty("schemaVersion");
  });

  it("reports malformed runner JSON clearly", async () => {
    const adapter = new PredictionRunnerJsonAdapter({
      python: "python", script: "runner.py", cwd: "/model", run: async () => "not-json",
    });
    await expect(adapter.predictPlayers("/tmp/replay.json"))
      .rejects.toThrow("Prediction runner returned malformed JSON.");
  });

  it("rejects JSON that does not match runner schema version 1", async () => {
    const adapter = new PredictionRunnerJsonAdapter({
      python: "python", script: "runner.py", cwd: "/model",
      run: async () => JSON.stringify({ ...runnerOutput, schemaVersion: 2 }),
    });
    await expect(adapter.predictPlayers("/tmp/replay.json"))
      .rejects.toThrow("Prediction runner returned malformed JSON.");
  });
});
