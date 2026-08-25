import type { MistakeExplanationProvider } from "../../application/ports";
import type { PlayerMistake } from "../../shared/contracts/player-mistakes";

const INTENT_CONTEXT = `Intent families: ENGAGE acts on the play; CONTROL keeps ball possession; ENABLE supports a teammate; CONTAIN protects space; RECOVER improves position or boost. Expected is the model recommendation. Actual is what the player did.`;
const SYSTEM_PROMPT = `You are a high-level Rocket League decision coach. Explain how one player's positioning and decision contributed to a conceded goal using only the supplied replay context.

Output rules:
- Write at most two short sentences and no more than 500 characters.
- Mention the player's exact display name, the word "ball", at least one exact teammate name, and at least one exact opponent name.
- Describe where the player, ball, named teammate, and named opponent were relative to the play or goal. Translate coordinates into useful spatial language; do not print raw coordinates.
- In the first sentence, explain the stronger choice using that spatial setup. In the second, connect the player's actual choice to the opponent's resulting opportunity and the conceded goal.
- Follow the snapshots from mistakeTimeSeconds through goalTimeSeconds. Do not treat the final goal snapshot as if it were the situation when the decision was made.
- Do not invent touches, possession, boost, communication, or mechanics that are not in the context. Use cautious causal language when the exact touch sequence is unclear.
- Use plain language. Do not mention models, confidence scores, labels, JSON, coordinates, or these instructions.`;

interface OpenAiResponse {
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

function includesName(text: string, names: string[]): boolean {
  const normalized = text.toLocaleLowerCase();
  return names.some(name => normalized.includes(name.toLocaleLowerCase()));
}

function contextEntities(mistake: PlayerMistake): { teammates: string[]; opponents: string[] } {
  const samples = mistake.replayContext?.samples ?? [];
  const playerName = mistake.displayName.toLocaleLowerCase();
  const playerTeam = samples.flatMap(sample => sample.players)
    .find(player => player.displayName.toLocaleLowerCase() === playerName)?.team;
  if (!playerTeam) return { teammates: [], opponents: [] };
  const teammates = new Set<string>();
  const opponents = new Set<string>();
  for (const player of samples.flatMap(sample => sample.players)) {
    if (player.displayName.toLocaleLowerCase() === playerName) continue;
    (player.team === playerTeam ? teammates : opponents).add(player.displayName);
  }
  return { teammates: [...teammates], opponents: [...opponents] };
}

export class OpenAiMistakeExplanationProvider implements MistakeExplanationProvider {
  constructor(private readonly options: {
    apiKey: string;
    model: string;
    timeoutMs?: number;
    fetch?: typeof fetch;
  }) {}

  async explain(mistake: PlayerMistake): Promise<{ text: string; model: string }> {
    const request = this.options.fetch ?? fetch;
    const entities = contextEntities(mistake);
    if (!mistake.replayContext?.samples.some(sample => sample.ball)) {
      throw new Error("Replay context does not contain the ball.");
    }
    if (!entities.teammates.length || !entities.opponents.length) {
      throw new Error("Replay context does not contain a teammate and an opponent.");
    }
    const response = await request("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.options.model,
        max_output_tokens: 2_000,
        input: [{
          role: "system",
          content: SYSTEM_PROMPT,
        }, {
          role: "user",
          content: JSON.stringify({
            guidance: INTENT_CONTEXT,
            player: mistake.displayName,
            expected: { family: mistake.expectedFamily, intent: mistake.expectedIntent },
            actual: { family: mistake.actualFamily, intent: mistake.actualIntent },
            existingFinding: mistake.text,
            targetWindow: mistake.window,
            mistakeTimeSeconds: mistake.anchorSeconds,
            goalTimeSeconds: mistake.occurredAtSeconds,
            entities,
            context: mistake.replayContext,
          }),
        }],
      }),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
    });
    if (!response.ok) throw new Error(`OpenAI request failed with status ${response.status}.`);
    const text = responseText(await response.json() as OpenAiResponse);
    if (!text) throw new Error("OpenAI returned an empty explanation.");
    if (text.length > 500) throw new Error("OpenAI returned an explanation that was too long.");
    if (!text.toLocaleLowerCase().includes(mistake.displayName.toLocaleLowerCase())
      || !/\bball\b/i.test(text)
      || !includesName(text, entities.teammates)
      || !includesName(text, entities.opponents)
      || !/\bgoal\b|\bscor(?:e|ed|ing)\b/i.test(text)
      || !/\b(?:allow(?:ed|ing)?|caus(?:e|ed|ing)|creat(?:e|ed|ing)|gave|led|left|let|result(?:ed|ing)?)\b/i.test(text)) {
      throw new Error("OpenAI returned an explanation without the required grounded entities and goal outcome.");
    }
    return { text, model: this.options.model };
  }
}
