import type { MistakeExplanationProvider, ReplayRepository } from "./ports";
import { mistakeExplanationResponseSchema, mistakeExplanationSchema, type MistakeExplanationResponse } from "../shared/contracts/player-mistakes";

export const MISTAKE_EXPLANATION_PROMPT_VERSION = "1";

export class MistakeNotFoundError extends Error {}
export class MistakeContextUnavailableError extends Error {}
export class MistakeExplanationUnavailableError extends Error {}

export class ExplainMistake {
  private readonly active = new Map<string, Promise<MistakeExplanationResponse>>();

  constructor(private readonly dependencies: {
    repository: ReplayRepository;
    provider?: MistakeExplanationProvider;
    now: () => Date;
  }) {}

  execute(id: string, createdBy: string): Promise<MistakeExplanationResponse> {
    const key = `${createdBy}\0${id}`;
    const existing = this.active.get(key);
    if (existing) return existing;
    const request = this.generate(id, createdBy).finally(() => this.active.delete(key));
    this.active.set(key, request);
    return request;
  }

  private async generate(id: string, createdBy: string): Promise<MistakeExplanationResponse> {
    const mistake = await this.dependencies.repository.getMistake(id, createdBy);
    if (!mistake) throw new MistakeNotFoundError("Mistake not found.");
    if (mistake.explanation) {
      return mistakeExplanationResponseSchema.parse({ mistakeId: id, explanation: mistake.explanation });
    }
    if (!mistake.replayContext?.samples.length) {
      throw new MistakeContextUnavailableError("Replay context is unavailable for this mistake.");
    }
    if (!this.dependencies.provider) {
      throw new MistakeExplanationUnavailableError("Mistake explanations are not configured.");
    }

    const generated = await this.dependencies.provider.explain(mistake);
    const explanation = mistakeExplanationSchema.parse({
      text: generated.text,
      generatedAt: this.dependencies.now().toISOString(),
      model: generated.model,
      promptVersion: MISTAKE_EXPLANATION_PROMPT_VERSION,
    });
    const saved = await this.dependencies.repository.saveMistakeExplanation(id, createdBy, explanation);
    if (!saved) throw new MistakeNotFoundError("Mistake not found.");
    return mistakeExplanationResponseSchema.parse({ mistakeId: id, explanation: saved });
  }
}
