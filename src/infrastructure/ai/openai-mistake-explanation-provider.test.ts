import { describe, expect, it, vi } from "vitest";
import type { PlayerMistake } from "../../shared/contracts/player-mistakes";
import { OpenAiMistakeExplanationProvider } from "./openai-mistake-explanation-provider";

describe("OpenAiMistakeExplanationProvider", () => {
  it("sends replay context to the Responses API and returns concise text", async () => {
    const explanation = "Alpha should rotate behind the ball because Bravo was covering while Opponent pressed. Alpha's early challenge removed that cover and let Opponent score the goal.";
    const request = vi.fn(async () => new Response(JSON.stringify({ output_text: explanation }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    const provider = new OpenAiMistakeExplanationProvider({ apiKey: "secret", model: "gpt-5.6", fetch: request });
    const mistake = {
      displayName: "Alpha", expectedFamily: "RECOVER", expectedIntent: "CLOSE_ROTATE",
      actualFamily: "ENGAGE", actualIntent: "CHALLENGE", text: "Engaged early.", window: "1-2s",
      anchorSeconds: 1,
      occurredAtSeconds: 2,
      replayContext: {
        sampleIntervalSeconds: 0.25, startSeconds: 0, endSeconds: 2, goalBoundarySeconds: null,
        samples: [{
          timeSeconds: 1,
          ball: { x: 0, y: 100, z: 90 },
          players: [
            { actorId: 1, displayName: "Alpha", team: "blue", position: { x: 0, y: 0, z: 17 }, yaw: 0, rotation: null },
            { actorId: 2, displayName: "Bravo", team: "blue", position: { x: 0, y: -500, z: 17 }, yaw: 0, rotation: null },
            { actorId: 3, displayName: "Opponent", team: "orange", position: { x: 0, y: 500, z: 17 }, yaw: 0, rotation: null },
          ],
        }],
      },
    } as unknown as PlayerMistake;
    await expect(provider.explain(mistake)).resolves.toEqual({ text: explanation, model: "gpt-5.6" });
    expect(request).toHaveBeenCalledWith("https://api.openai.com/v1/responses", expect.objectContaining({ method: "POST" }));
    const calls = request.mock.calls as unknown as Array<[string, RequestInit]>;
    const body = JSON.parse(String(calls[0][1].body));
    expect(body).toMatchObject({ model: "gpt-5.6", max_output_tokens: 1_000 });
    expect(body.input[0].content).toContain("at least one exact teammate name");
    expect(body.input[1].content).toContain("CLOSE_ROTATE");
    expect(JSON.parse(body.input[1].content)).toMatchObject({
      mistakeTimeSeconds: 1,
      goalTimeSeconds: 2,
      entities: { teammates: ["Bravo"], opponents: ["Opponent"] },
    });
    expect(calls[0][1].headers).toMatchObject({ Authorization: "Bearer secret" });
  });

  it("rejects an explanation that does not ground the required entities", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ output_text: "Alpha should rotate back to prevent the goal." }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    const provider = new OpenAiMistakeExplanationProvider({ apiKey: "secret", model: "gpt-5.6", fetch: request });
    const mistake = {
      displayName: "Alpha",
      replayContext: { samples: [{
        ball: { x: 0, y: 0, z: 0 },
        players: [
          { displayName: "Alpha", team: "blue" },
          { displayName: "Bravo", team: "blue" },
          { displayName: "Opponent", team: "orange" },
        ],
      }] },
    } as unknown as PlayerMistake;

    await expect(provider.explain(mistake)).rejects.toThrow("without the required grounded entities");
  });
});
