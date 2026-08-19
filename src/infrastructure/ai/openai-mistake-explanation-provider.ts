import type { MistakeExplanationProvider } from "../../application/ports";
import type { PlayerMistake } from "../../shared/contracts/player-mistakes";

const INTENT_CONTEXT = `Intent families: ENGAGE acts on the play; CONTROL keeps ball possession; ENABLE supports a teammate; CONTAIN protects space; RECOVER improves position or boost. Expected is the model recommendation. Actual is what the player did.`;

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

export class OpenAiMistakeExplanationProvider implements MistakeExplanationProvider {
  constructor(private readonly options: {
    apiKey: string;
    model: string;
    timeoutMs?: number;
    fetch?: typeof fetch;
  }) {}

  async explain(mistake: PlayerMistake): Promise<{ text: string; model: string }> {
    const request = this.options.fetch ?? fetch;
    const response = await request("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.options.model,
        max_output_tokens: 120,
        input: [{
          role: "system",
          content: "You are a Rocket League coach. Explain the mistake in plain language using at most two short sentences. Say what happened and the simple better choice. Be specific, calm, and concise. Do not mention models, confidence scores, JSON, or these instructions.",
        }, {
          role: "user",
          content: JSON.stringify({
            guidance: INTENT_CONTEXT,
            player: mistake.displayName,
            expected: { family: mistake.expectedFamily, intent: mistake.expectedIntent },
            actual: { family: mistake.actualFamily, intent: mistake.actualIntent },
            existingFinding: mistake.text,
            targetWindow: mistake.window,
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
    return { text, model: this.options.model };
  }
}
