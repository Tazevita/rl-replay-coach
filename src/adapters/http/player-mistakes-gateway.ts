import {
  mistakeExplanationResponseSchema,
  playerWeaknessesResponseSchema,
  playerMistakesResponseSchema,
  type MistakeExplanationResponse,
  type PlayerMistakesResponse,
  type PlayerWeaknessesResponse,
} from "../../shared/contracts/player-mistakes";

export interface PlayerMistakesGateway {
  getByUsername(username: string, replayLimit: number): Promise<PlayerMistakesResponse>;
  explain(mistakeId: string): Promise<MistakeExplanationResponse>;
  getWeaknesses(username: string, replayLimit: number): Promise<PlayerWeaknessesResponse>;
}

async function responseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function responseError(body: unknown, fallback: string): Error {
  const message = typeof body === "object" && body && "error" in body ? String(body.error) : fallback;
  return new Error(message);
}

export class HttpPlayerMistakesGateway implements PlayerMistakesGateway {
  constructor(private readonly request: typeof fetch = fetch) {}

  async getByUsername(username: string, replayLimit: number): Promise<PlayerMistakesResponse> {
    const response = await this.request(`/api/player-mistakes?username=${encodeURIComponent(username.trim())}&replays=${replayLimit}`);
    const body = await responseBody(response);
    if (!response.ok) throw responseError(body, "Could not load player mistakes.");
    return playerMistakesResponseSchema.parse(body);
  }

  async explain(mistakeId: string): Promise<MistakeExplanationResponse> {
    const response = await this.request(`/api/player-mistakes/${encodeURIComponent(mistakeId)}/explanation`, { method: "POST" });
    const body = await responseBody(response);
    if (!response.ok) throw responseError(body, "Could not explain the mistake.");
    return mistakeExplanationResponseSchema.parse(body);
  }

  async getWeaknesses(username: string, replayLimit: number): Promise<PlayerWeaknessesResponse> {
    const response = await this.request(`/api/player-mistakes/work-on?username=${encodeURIComponent(username.trim())}&replays=${replayLimit}`, { method: "POST" });
    const body = await responseBody(response);
    if (!response.ok) throw responseError(
      body,
      response.status === 404
        ? "Player coaching is not active. Restart the replay server and try again."
        : "Could not analyze this player.",
    );
    return playerWeaknessesResponseSchema.parse(body);
  }
}
