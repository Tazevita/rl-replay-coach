import { describe, expect, it, vi } from "vitest";
import type { PlayerMistakesResponse } from "../../shared/contracts/player-mistakes";
import { OpenAiPlayerWeaknessesProvider } from "./openai-player-weaknesses-provider";

describe("OpenAiPlayerWeaknessesProvider", () => {
  it("sends every mistake and parses structured coaching priorities", async () => {
    const content = {
      weaknesses: [{ weakness: "Recover first", pattern: "You engage before recovering.", workOn: "Get goal-side before challenging.", remember: "When you lose the play, rotate behind your teammate." }],
    };
    const request = vi.fn(async () => new Response(JSON.stringify({ output_text: JSON.stringify(content) }), { status: 200 }));
    const provider = new OpenAiPlayerWeaknessesProvider({ apiKey: "secret", model: "gpt-5.6-luna", fetch: request });
    const player = {
      username: "Alpha", replayCount: 2,
      tacticalFocus: [{ expectedFamily: "RECOVER", actualFamily: "ENGAGE", count: 2, averageScore: 1.25 }],
      decisionHabits: [{ expectedIntent: "FAR_ROTATE", actualIntent: "CHALLENGE", count: 2, averageScore: 1.25 }],
      mistakes: [1, 2].map(index => ({
        replayId: `replay-${index}`, expectedFamily: "RECOVER", expectedIntent: "FAR_ROTATE",
        actualFamily: "ENGAGE", actualIntent: "CHALLENGE", score: index, sampleCount: 2,
        window: "1-2s", text: "Engaged before recovering.",
      })),
    } as unknown as PlayerMistakesResponse;

    await expect(provider.analyze(player)).resolves.toEqual({ content, model: "gpt-5.6-luna" });
    const calls = request.mock.calls as unknown as Array<[string, RequestInit]>;
    const body = JSON.parse(String(calls[0][1].body));
    expect(body).toMatchObject({ model: "gpt-5.6-luna", max_output_tokens: 3_000, text: { format: { type: "json_schema", strict: true } } });
    expect(body.text.format.schema.properties.weaknesses.items.properties.workOn).toMatchObject({ maxLength: 500, pattern: "^[ -~]+$" });
    expect(JSON.parse(body.input[1].content).mistakes).toHaveLength(2);
    expect(body.input[0].content).toContain("Expected ENGAGE with actual RECOVER");
    expect(body.input[0].content).toContain("Never combine unrelated issues");
    expect(body.input[0].content).toContain("one specific practice focus");
    expect(body.input[0].content).toContain("For expected CLOSE_ROTATE with actual FAR_ROTATE");
    expect(body.input[0].content).toContain("For expected FAR_ROTATE with actual CLOSE_ROTATE");
    expect(body.input[0].content).toContain("Never choose a route only because the ball is on that side");
    expect(body.input[0].content).toContain("plain 2-5 word title");
    expect(body.input[0].content).toContain("SUPPORT is often a good choice");
    expect(body.input[0].content).toContain("Never merge different expected recovery intents");
    expect(body.input[0].content).toContain("For expected CLOSE_ROTATE with actual SUPPORT");
    expect(body.input[0].content).toContain("When [recognizable cue], [specific action].");
  });

  it("reports a response cut off at the output limit", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({
      status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output_text: "{",
    }), { status: 200 }));
    const provider = new OpenAiPlayerWeaknessesProvider({ apiKey: "secret", model: "gpt-5.6-luna", fetch: request });
    await expect(provider.analyze({ username: "Alpha", replayCount: 1, tacticalFocus: [], decisionHabits: [], mistakes: [] } as unknown as PlayerMistakesResponse))
      .rejects.toThrow("OpenAI returned an incomplete player analysis: max_output_tokens.");
  });
});
