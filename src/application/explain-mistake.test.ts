import { describe, expect, it, vi } from "vitest";
import type { MistakeExplanationProvider, ReplayRepository } from "./ports";
import type { PlayerMistake } from "../shared/contracts/player-mistakes";
import { ExplainMistake, MistakeExplanationUnavailableError } from "./explain-mistake";

const mistake: PlayerMistake = {
  id: "replay:finding",
  replayId: "replay",
  replayFilename: "match.replay",
  playerId: "alpha",
  displayName: "Alpha",
  eventId: "goal-1",
  occurredAtSeconds: 50,
  anchorSeconds: 48,
  expectedFamily: "RECOVER",
  actualFamily: "ENGAGE",
  expectedIntent: "CLOSE_ROTATE",
  actualIntent: "CHALLENGE",
  score: 1.5,
  sampleCount: 3,
  window: "1-2s",
  text: "Alpha engaged before recovering.",
  analyzedAt: "2026-08-17T12:00:00.000Z",
  replayContext: {
    sampleIntervalSeconds: 0.25,
    startSeconds: 36,
    endSeconds: 48,
    goalBoundarySeconds: null,
    samples: [{ timeSeconds: 48, ball: null, players: [] }],
  },
  explanation: null,
};

function repository(initial = mistake): ReplayRepository {
  let saved = initial;
  return {
    listReplays: vi.fn(), deleteReplay: vi.fn(),
    findBundleByHash: vi.fn(), publish: vi.fn(), getReplay: vi.fn(), getBundle: vi.fn(), getPlayerMistakes: vi.fn(),
    getMistake: vi.fn(async () => saved),
    saveMistakeExplanation: vi.fn(async (_id, _createdBy, explanation) => {
      saved = { ...saved, explanation };
      return explanation;
    }),
  };
}

describe("ExplainMistake", () => {
  it("coalesces concurrent generation and returns the stored explanation later", async () => {
    const replayRepository = repository();
    const provider: MistakeExplanationProvider = {
      explain: vi.fn(async () => ({ text: "Rotate back before challenging.", model: "gpt-5.6" })),
    };
    const useCase = new ExplainMistake({ repository: replayRepository, provider, now: () => new Date("2026-08-19T12:00:00Z") });
    const [first, second] = await Promise.all([
      useCase.execute(mistake.id, "johndoe"),
      useCase.execute(mistake.id, "johndoe"),
    ]);
    expect(first).toEqual(second);
    expect(first.explanation.text).toBe("Rotate back before challenging.");
    expect(first.explanation.promptVersion).toBe("2");
    await useCase.execute(mistake.id, "johndoe");
    expect(provider.explain).toHaveBeenCalledTimes(1);
  });

  it("regenerates an explanation created by an older prompt", async () => {
    const replayRepository = repository({
      ...mistake,
      explanation: {
        text: "Old generic advice.",
        generatedAt: "2026-08-18T12:00:00.000Z",
        model: "gpt-5.6",
        promptVersion: "1",
      },
    });
    const provider: MistakeExplanationProvider = {
      explain: vi.fn(async () => ({ text: "Grounded replacement.", model: "gpt-5.6" })),
    };
    const useCase = new ExplainMistake({ repository: replayRepository, provider, now: () => new Date("2026-08-19T12:00:00Z") });

    const result = await useCase.execute(mistake.id, "johndoe");

    expect(result.explanation).toMatchObject({ text: "Grounded replacement.", promptVersion: "2" });
    expect(provider.explain).toHaveBeenCalledOnce();
  });

  it("reports missing configuration only when no cached explanation exists", async () => {
    const useCase = new ExplainMistake({ repository: repository(), now: () => new Date() });
    await expect(useCase.execute(mistake.id, "johndoe")).rejects.toBeInstanceOf(MistakeExplanationUnavailableError);
  });
});
