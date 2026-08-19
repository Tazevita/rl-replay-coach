import { describe, expect, it, vi } from "vitest";
import type { PlayerMistake } from "../../shared/contracts/player-mistakes";
import { OpenAiMistakeExplanationProvider } from "./openai-mistake-explanation-provider";

describe("OpenAiMistakeExplanationProvider", () => {
  it("sends replay context to the Responses API and returns concise text", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ output_text: "Rotate back first, then challenge." }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    const provider = new OpenAiMistakeExplanationProvider({ apiKey: "secret", model: "gpt-5.6", fetch: request });
    const mistake = {
      displayName: "Alpha", expectedFamily: "RECOVER", expectedIntent: "CLOSE_ROTATE",
      actualFamily: "ENGAGE", actualIntent: "CHALLENGE", text: "Engaged early.", window: "1-2s",
      replayContext: { sampleIntervalSeconds: 0.25, startSeconds: 0, endSeconds: 1, goalBoundarySeconds: null, samples: [] },
    } as unknown as PlayerMistake;
    await expect(provider.explain(mistake)).resolves.toEqual({ text: "Rotate back first, then challenge.", model: "gpt-5.6" });
    expect(request).toHaveBeenCalledWith("https://api.openai.com/v1/responses", expect.objectContaining({ method: "POST" }));
    const calls = request.mock.calls as unknown as Array<[string, RequestInit]>;
    const body = JSON.parse(String(calls[0][1].body));
    expect(body).toMatchObject({ model: "gpt-5.6", max_output_tokens: 120 });
    expect(body.input[1].content).toContain("CLOSE_ROTATE");
    expect(calls[0][1].headers).toMatchObject({ Authorization: "Bearer secret" });
  });
});
