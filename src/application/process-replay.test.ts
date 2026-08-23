import { describe, expect, it, vi } from "vitest";
import { replayData, validBundle } from "../test/fixtures";
import { ProcessReplay } from "./process-replay";
import type { AnalysisProvider, ReplayParser, ReplayRepository, ReplaySource } from "./ports";

const teams = [{
  id: "blue", team: { id: "blue" as const, displayName: "Blue" }, players: [],
  score: { for: 0, against: 0 }, events: [],
}];
const playerPredictions = { sampleIntervalSeconds: 0.5, players: [] };

function source(dispose = vi.fn(async () => {})): ReplaySource {
  return { filename: "match.replay", path: "/private/upload.replay", contentHash: "hash", createdBy: "johndoe", dispose };
}

function repository(): ReplayRepository {
  return {
    listReplays: vi.fn(async () => []),
    deleteReplay: vi.fn(async () => false),
    findBundleByHash: vi.fn(async () => undefined),
    publish: vi.fn(async record => record.bundle),
    getReplay: vi.fn(),
    getBundle: vi.fn(),
    getPlayerMistakes: vi.fn(),
    getMistake: vi.fn(),
    saveMistakeExplanation: vi.fn(),
  };
}

function setup(overrides: { parser?: ReplayParser; analysis?: AnalysisProvider; repository?: ReplayRepository } = {}) {
  const parsedDispose = vi.fn(async () => {});
  const parser = overrides.parser ?? { parse: vi.fn(async () => ({
    data: replayData,
    analysisInputPath: "/private/replay.json",
    objectKey: "jobs/1/parsed/replay.json",
    dispose: parsedDispose,
  })) };
  const analysisProvider = overrides.analysis ?? { analyze: vi.fn(async () => ({ provider: "fake", teams, playerPredictions })) };
  const replayRepository = overrides.repository ?? repository();
  const useCase = new ProcessReplay({ parser, analysisProvider, repository: replayRepository, createId: () => "opaque", now: () => new Date("2026-08-17T12:00:00Z") });
  return { useCase, parser, analysisProvider, repository: replayRepository, parsedDispose };
}

describe("ProcessReplay", () => {
  it("orchestrates complete success and publishes a path-free versioned response", async () => {
    const { useCase, repository, parsedDispose } = setup();
    const uploadDispose = vi.fn(async () => {});
    const bundle = await useCase.execute(source(uploadDispose));
    expect(repository.publish).toHaveBeenCalledWith(expect.objectContaining({
      id: "opaque",
      contentHash: "hash",
      createdBy: "johndoe",
      replay: replayData,
      replayObjectKey: "jobs/1/parsed/replay.json",
    }));
    expect(bundle.replay.dataUrl).toBe("/api/replays/opaque/data");
    expect(bundle.schemaVersion).toBe(2);
    expect(bundle.analysis.playerPredictions).toEqual(playerPredictions);
    expect(JSON.stringify(bundle)).not.toContain("/private/");
    expect(parsedDispose).toHaveBeenCalled();
    expect(uploadDispose).toHaveBeenCalled();
  });

  it("cleans the upload after parser failure without publishing", async () => {
    const uploadDispose = vi.fn(async () => {});
    const replayRepository = repository();
    const { useCase } = setup({ parser: { parse: vi.fn(async () => { throw new Error("parse failed"); }) }, repository: replayRepository });
    await expect(useCase.execute(source(uploadDispose))).rejects.toThrow("parse failed");
    expect(uploadDispose).toHaveBeenCalled();
    expect(replayRepository.publish).not.toHaveBeenCalled();
  });

  it("cleans parser and upload artifacts after analysis failure without publishing", async () => {
    const replayRepository = repository();
    const { useCase, parsedDispose } = setup({
      analysis: { analyze: vi.fn(async () => { throw new Error("analysis failed"); }) }, repository: replayRepository,
    });
    await expect(useCase.execute(source())).rejects.toThrow("analysis failed");
    expect(parsedDispose).toHaveBeenCalled();
    expect(replayRepository.publish).not.toHaveBeenCalled();
  });

  it("returns a creator-scoped duplicate without parsing it again", async () => {
    const stored = validBundle();
    const replayRepository = repository();
    vi.mocked(replayRepository.findBundleByHash).mockResolvedValue(stored);
    const { useCase, parser, analysisProvider } = setup({ repository: replayRepository });
    const uploadDispose = vi.fn(async () => {});
    await expect(useCase.execute(source(uploadDispose))).resolves.toEqual(stored);
    expect(replayRepository.findBundleByHash).toHaveBeenCalledWith("johndoe", "hash");
    expect(parser.parse).not.toHaveBeenCalled();
    expect(analysisProvider.analyze).not.toHaveBeenCalled();
    expect(uploadDispose).toHaveBeenCalled();
  });

  it("rejects a new replay when the creator already has 50 saved replays", async () => {
    const replayRepository = repository();
    vi.mocked(replayRepository.listReplays).mockResolvedValue(Array.from({ length: 50 }, (_, index) => ({
      id: `replay-${index}`,
      filename: `match-${index}.replay`,
      analyzedAt: "2026-08-17T12:00:00.000Z",
    })));
    const { useCase, parser, analysisProvider } = setup({ repository: replayRepository });
    const uploadDispose = vi.fn(async () => {});

    await expect(useCase.execute(source(uploadDispose))).rejects.toThrow("You can store up to 50 replays");
    expect(parser.parse).not.toHaveBeenCalled();
    expect(analysisProvider.analyze).not.toHaveBeenCalled();
    expect(uploadDispose).toHaveBeenCalled();
  });
});
