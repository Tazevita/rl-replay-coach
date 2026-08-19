import { describe, expect, it, vi } from "vitest";
import type { PredictionAnalysisResult, TeamAnalysisResult } from "../../application/ports";
import { CompositeAnalysisProvider } from "./composite-analysis-provider";

describe("CompositeAnalysisProvider", () => {
  it("runs team and prediction analysis concurrently and merges their results", async () => {
    let resolveTeams!: (value: TeamAnalysisResult) => void;
    let resolvePredictions!: (value: PredictionAnalysisResult) => void;
    const analyzeTeams = vi.fn(() => new Promise<TeamAnalysisResult>(resolve => { resolveTeams = resolve; }));
    const predictPlayers = vi.fn(() => new Promise<PredictionAnalysisResult>(resolve => { resolvePredictions = resolve; }));
    const provider = new CompositeAnalysisProvider({ analyzeTeams }, { predictPlayers });

    const pending = provider.analyze("/tmp/replay.json");
    expect(analyzeTeams).toHaveBeenCalledWith("/tmp/replay.json");
    expect(predictPlayers).toHaveBeenCalledWith("/tmp/replay.json");

    resolveTeams({ provider: "goals", modelVersion: "goal-v1", teams: [] });
    resolvePredictions({
      provider: "predictions",
      playerPredictions: { sampleIntervalSeconds: 0.5, players: [] },
    });

    await expect(pending).resolves.toEqual({
      provider: "goals+predictions",
      modelVersion: "goal-v1",
      teams: [],
      playerPredictions: { sampleIntervalSeconds: 0.5, players: [] },
    });
  });
});
