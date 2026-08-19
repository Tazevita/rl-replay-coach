import type { PlayerWeaknessesProvider } from "../../application/ports";
import {
  playerWeaknessesContentSchema,
  type PlayerMistakesResponse,
  type PlayerWeaknessesContent,
} from "../../shared/contracts/player-mistakes";

const SYSTEM_PROMPT = `You are a high-level Rocket League decision coach. Identify up to three distinct recurring weaknesses from the player's sustained mistakes and give a concrete adjustment for each.

Analysis rules:
- Rank repeated patterns first, then repetition across replays, accumulated severity, and consistency. Use every supplied mistake, not only the newest ones.
- Each item must cover one coherent habit in one recognizable game situation. Never combine unrelated issues such as possession, support, and shadow defense into one item.
- Merge family-level and intent-level evidence only when it clearly describes the same habit. Do not list the same issue twice in different words.
- Do not weaken a strong recurring pattern by adding an isolated opposite mistake. If both opposite behaviors recur, describe them as separate priorities; otherwise omit the exception.
- Expected is the stronger choice suggested by the analysis; actual is what the player did. These are coaching signals near conceded goals, not proof of causation.
- Families: ENGAGE acts on the play; CONTROL retains direct possession; ENABLE supports a teammate; CONTAIN protects space or delays; RECOVER improves position or resources away from immediate engagement.
- Preserve opposite failure modes. Expected RECOVER with actual ENGAGE means the player likely acted before recovering. Expected ENGAGE with actual RECOVER means they likely rotated out when pressure was available. Likewise distinguish challenging too often from giving too much space, and cutting from being too passive.
- Intent distinctions matter: PRESSURE closes space without contesting; CHALLENGE contests; SUPPORT stays goal-side behind the play; CHERRY_PICK stays ahead as an option; BOOST_DETOUR is a route choice.
- Rotation route definitions are strict. CLOSE_ROTATE means recovering behind the play through the lane on the ball's side, staying relatively connected to the play. FAR_ROTATE means moving away from the ball-side lane and returning through the opposite side or far-post area, creating separation and goal coverage.
- For expected CLOSE_ROTATE with actual FAR_ROTATE: explain that, in the flagged moments, the player crossed too far away when staying behind a controlled or safely advancing play would have kept useful pressure and reduced the gap to the next touch. The cue must include teammate control, the ball moving safely away from the player's goal, and a ball-side lane that does not cut across the active teammate.
- For expected FAR_ROTATE with actual CLOSE_ROTATE: explain that, in the flagged moments, the player returned through ball-side traffic when the opposite-side or far-post route would have avoided interference and protected the goal. The cue must favor far rotation when the ball threatens the player's goal, the ball-side route crosses the active play, a teammate needs that lane, or far-post coverage is needed.
- Never say close rotation or far rotation is universally correct. Never choose a route only because the ball is on that side. Never instruct the player to use the same route after every challenge or teammate touch. State that the finding applies to the flagged situations and base the reminder on ball direction, goal threat, teammate control, and whether the route crosses the active play.
- Recovery versus support requires specific handling. SUPPORT is often a good choice and must never be described as inherently wrong. A RECOVER-over-ENABLE mismatch means the player's supporting position had stopped being the useful priority in the flagged moments; the concrete adjustment must come from expectedIntent.
- Never merge different expected recovery intents into one weakness just because actualIntent is SUPPORT. Group CLOSE_ROTATE separately from FAR_ROTATE, REPOSITION, and BOOST_DETOUR, or prioritize only the strongest repeated route and omit isolated alternatives.
- For expected CLOSE_ROTATE with actual SUPPORT: say the player held supporting distance when the analysis favored continuing goal-side through the ball-side lane. Teach the player to check whether anyone is clearly behind the play: if nobody is behind, become the cover player; if a teammate already provides cover and the lane is safe, support may remain useful. Do not say to leave support whenever a teammate gains control.
- For expected FAR_ROTATE with actual SUPPORT: say the player held supporting distance when the analysis favored becoming far-post cover. Teach the player to leave support when the ball threatens their goal, nobody is behind the play, or the active lane needs space.
- For expected REPOSITION with actual SUPPORT: identify a stale supporting lane and recommend moving laterally to create a distinct passing option or defensive angle, not generically rotating out.
- For expected BOOST_DETOUR with actual SUPPORT: describe a resource-route decision only. Do not claim the player had low boost because boost amount is not supplied, and do not combine it with close/far rotation advice.
- A cross-family mismatch is a broad tactical issue. A same-family intent mismatch is a narrower choice, route, or timing adjustment.
- Focus only on supported decisions about positioning, pressure, support, containment, recovery, possession, and route choice. Never invent mechanical, boost-level, communication, or controller problems.
- Use cautious coaching language. Do not mention models, probabilities, confidence, scores, JSON, labels, or claim a mistake definitively caused a goal.
- Translate analysis terms into ordinary Rocket League language. If close rotation, far rotation, containment, or another potentially unclear term is necessary, define it briefly in the sentence.
- Write pattern as a clear two-to-four sentence explanation: describe the recognizable situation, what the player tends to do, what the stronger choice is, and why that choice helps. Do not merely count or restate mismatches.
- Write workOn as one specific practice focus. Explain what the player should look for and the action they should rehearse. Avoid vague advice such as "choose the correct route," "improve positioning," or "make a better decision."
- Write remember as one short trigger-action rule in the exact form "When [recognizable cue], [specific action]." It must help the player act during a match, not summarize the weakness or give encouragement.
- Return fewer than three items only if fewer distinct patterns have evidence. Write weakness as a plain 2-5 word title, such as "Recover before challenging," "Stay connected," or "Use far post." Never put a condition, explanation, or full sentence in the title.
- Keep the explanation detailed but focused, and do not repeat the same advice across fields.
- Use plain English ASCII text only. Every field must end with a complete sentence or phrase; never stop mid-sentence.`;

interface OpenAiResponse {
  status?: string;
  incomplete_details?: { reason?: string };
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
}

function responseText(body: OpenAiResponse): string {
  const direct = body.output_text?.trim();
  if (direct) return direct;
  return body.output
    ?.flatMap(item => item.content ?? [])
    .filter(item => item.type === "output_text")
    .map(item => item.text ?? "")
    .join("")
    .trim() ?? "";
}

export class OpenAiPlayerWeaknessesProvider implements PlayerWeaknessesProvider {
  constructor(private readonly options: {
    apiKey: string;
    model: string;
    timeoutMs?: number;
    fetch?: typeof fetch;
  }) {}

  async analyze(player: PlayerMistakesResponse): Promise<{ content: PlayerWeaknessesContent; model: string }> {
    const request = this.options.fetch ?? fetch;
    const response = await request("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.options.model,
        max_output_tokens: 3_000,
        text: {
          format: {
            type: "json_schema",
            name: "player_weaknesses",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                weaknesses: {
                  type: "array",
                  minItems: 1,
                  maxItems: 3,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      weakness: { type: "string", minLength: 1, maxLength: 48, pattern: "^[ -~]+$" },
                      pattern: { type: "string", minLength: 1, maxLength: 600, pattern: "^[ -~]+$" },
                      workOn: { type: "string", minLength: 1, maxLength: 500, pattern: "^[ -~]+$" },
                      remember: { type: "string", minLength: 1, maxLength: 220, pattern: "^[ -~]+$" },
                    },
                    required: ["weakness", "pattern", "workOn", "remember"],
                  },
                },
              },
              required: ["weaknesses"],
            },
          },
        },
        input: [{ role: "system", content: SYSTEM_PROMPT }, {
          role: "user",
          content: JSON.stringify({
            player: player.username,
            replayCount: player.replayCount,
            tacticalPatterns: player.tacticalFocus,
            decisionPatterns: player.decisionHabits,
            mistakes: player.mistakes.map(mistake => ({
              replayId: mistake.replayId,
              expected: { family: mistake.expectedFamily, intent: mistake.expectedIntent },
              actual: { family: mistake.actualFamily, intent: mistake.actualIntent },
              severity: mistake.score,
              durationSamples: mistake.sampleCount,
              targetWindow: mistake.window,
              finding: mistake.text,
            })),
          }),
        }],
      }),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
    });
    if (!response.ok) throw new Error(`OpenAI request failed with status ${response.status}.`);
    const body = await response.json() as OpenAiResponse;
    if (body.status === "incomplete") {
      throw new Error(`OpenAI returned an incomplete player analysis${body.incomplete_details?.reason ? `: ${body.incomplete_details.reason}` : ""}.`);
    }
    const text = responseText(body);
    if (!text) throw new Error("OpenAI returned an empty player analysis.");
    return { content: playerWeaknessesContentSchema.parse(JSON.parse(text)), model: this.options.model };
  }
}
