import type { PlayerWeaknessesProvider, ReplayRepository } from "./ports";
import {
  playerWeaknessesResponseSchema,
  type PlayerWeaknessesResponse,
} from "../shared/contracts/player-mistakes";

export const PLAYER_WEAKNESSES_PROMPT_VERSION = "8";

export class PlayerWeaknessesNotFoundError extends Error {}
export class PlayerWeaknessesUnavailableError extends Error {}

export class AnalyzePlayerWeaknesses {
  private readonly active = new Map<string, Promise<PlayerWeaknessesResponse>>();

  constructor(private readonly dependencies: {
    repository: ReplayRepository;
    provider?: PlayerWeaknessesProvider;
    now: () => Date;
  }) {}

  execute(username: string, createdBy: string, replayLimit: number): Promise<PlayerWeaknessesResponse> {
    const key = `${createdBy}\0${username.toLowerCase()}\0${replayLimit}`;
    const existing = this.active.get(key);
    if (existing) return existing;
    const request = this.generate(username, createdBy, replayLimit).finally(() => this.active.delete(key));
    this.active.set(key, request);
    return request;
  }

  private async generate(username: string, createdBy: string, replayLimit: number): Promise<PlayerWeaknessesResponse> {
    const player = await this.dependencies.repository.getPlayerMistakes(username, createdBy, replayLimit);
    if (!player.playerIds.length || !player.mistakes.length) {
      throw new PlayerWeaknessesNotFoundError("No sustained mistakes are available for this player.");
    }
    if (!this.dependencies.provider) {
      throw new PlayerWeaknessesUnavailableError("Player coaching is not configured.");
    }

    const generated = await this.dependencies.provider.analyze(player);
    return playerWeaknessesResponseSchema.parse({
      ...generated.content,
      username: player.username,
      generatedAt: this.dependencies.now().toISOString(),
      model: generated.model,
      promptVersion: PLAYER_WEAKNESSES_PROMPT_VERSION,
    });
  }
}
