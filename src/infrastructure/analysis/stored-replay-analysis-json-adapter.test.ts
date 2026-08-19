import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StoredReplayAnalysisJsonAdapter } from "./stored-replay-analysis-json-adapter";

const analysis = {
  schemaVersion: 1,
  teams: [{
    id: "blue",
    team: { id: "blue", displayName: "Blue" },
    players: [],
    score: { for: 0, against: 0 },
    events: [],
  }],
  playerPredictions: { sampleIntervalSeconds: 1, players: [] },
};

describe("StoredReplayAnalysisJsonAdapter", () => {
  it("reads and validates combined analysis without launching a process", async () => {
    const directory = await mkdtemp(join(tmpdir(), "stored-analysis-test-"));
    try {
      const path = join(directory, "analysis.json");
      await writeFile(path, JSON.stringify(analysis));
      const adapter = new StoredReplayAnalysisJsonAdapter({ modelVersion: "model-1" });
      await expect(adapter.analyze(path)).resolves.toEqual({
        provider: "aws-lambda-replay-analysis",
        modelVersion: "model-1",
        teams: analysis.teams,
        playerPredictions: analysis.playerPredictions,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects malformed stored analysis", async () => {
    const directory = await mkdtemp(join(tmpdir(), "stored-analysis-test-"));
    try {
      const path = join(directory, "analysis.json");
      await writeFile(path, "{}");
      await expect(new StoredReplayAnalysisJsonAdapter().analyze(path)).rejects.toThrow(
        "Stored replay analysis returned malformed JSON.",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
