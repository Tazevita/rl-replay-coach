import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpPlayerMistakesGateway } from "./player-mistakes-gateway";

afterEach(() => vi.unstubAllGlobals());

describe("HttpPlayerMistakesGateway", () => {
  it("requests and validates a generated explanation", async () => {
    const body = {
      mistakeId: "replay:finding",
      explanation: { text: "Rotate first.", generatedAt: "2026-08-19T12:00:00.000Z", model: "gpt-5.6", promptVersion: "1" },
    };
    const request = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal("fetch", request);
    await expect(new HttpPlayerMistakesGateway().explain("replay:finding")).resolves.toEqual(body);
    expect(request).toHaveBeenCalledWith("/api/player-mistakes/replay%3Afinding/explanation", { method: "POST" });
  });

  it("requests and validates player weaknesses", async () => {
    const body = {
      username: "Alpha", generatedAt: "2026-08-19T12:00:00.000Z", model: "gpt-5.6-luna", promptVersion: "1",
      weaknesses: [{ weakness: "Recover first", pattern: "You engage before recovering.", workOn: "Get goal-side before challenging.", remember: "When you lose the play, rotate behind your teammate." }],
    };
    const request = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal("fetch", request);
    await expect(new HttpPlayerMistakesGateway().getWeaknesses(" Alpha ", 5)).resolves.toEqual(body);
    expect(request).toHaveBeenCalledWith("/api/player-mistakes/work-on?username=Alpha&replays=5", { method: "POST" });
  });

  it("explains when the running server does not have the coaching route", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    await expect(new HttpPlayerMistakesGateway().getWeaknesses("Alpha", 50)).rejects.toThrow(
      "Player coaching is not active. Restart the replay server and try again.",
    );
  });
});
