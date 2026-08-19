import { describe, expect, it, vi } from "vitest";
import type { ReplayRepository } from "./ports";
import { AnalyzePlayerWeaknesses, PlayerWeaknessesNotFoundError } from "./analyze-player-weaknesses";

describe("AnalyzePlayerWeaknesses", () => {
  it("coalesces concurrent requests and adds generation provenance", async () => {
    const player = { username: "Alpha", playerIds: ["alpha"], mistakes: [{}] } as never;
    const repository = { getPlayerMistakes: vi.fn(async () => player) } as unknown as ReplayRepository;
    const provider = { analyze: vi.fn(async () => ({
      model: "gpt-5.6-luna",
      content: { weaknesses: [{ weakness: "Recover first", pattern: "You engage too soon.", workOn: "Get goal-side first.", remember: "When you lose the play, rotate behind your teammate." }] },
    })) };
    const useCase = new AnalyzePlayerWeaknesses({ repository, provider, now: () => new Date("2026-08-19T12:00:00.000Z") });
    const [first, second] = await Promise.all([useCase.execute("Alpha", "johndoe", 5), useCase.execute("alpha", "johndoe", 5)]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ username: "Alpha", model: "gpt-5.6-luna", promptVersion: "8" });
    expect(provider.analyze).toHaveBeenCalledTimes(1);
    expect(repository.getPlayerMistakes).toHaveBeenCalledWith("Alpha", "johndoe", 5);
  });

  it("does not call the provider without sustained mistakes", async () => {
    const repository = { getPlayerMistakes: vi.fn(async () => ({ playerIds: ["alpha"], mistakes: [] })) } as unknown as ReplayRepository;
    const provider = { analyze: vi.fn() };
    const useCase = new AnalyzePlayerWeaknesses({ repository, provider, now: () => new Date() });
    await expect(useCase.execute("Alpha", "johndoe", 50)).rejects.toBeInstanceOf(PlayerWeaknessesNotFoundError);
    expect(provider.analyze).not.toHaveBeenCalled();
  });
});
