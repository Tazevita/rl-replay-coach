import { replayHistorySchema, type ReplayHistoryItem } from "../../shared/contracts/replay-history";

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => undefined) as { error?: unknown } | undefined;
  return typeof body?.error === "string" ? body.error : fallback;
}

export class HttpReplayHistoryGateway {
  constructor(private readonly request: typeof fetch = fetch) {}

  async list(): Promise<ReplayHistoryItem[]> {
    const response = await this.request("/api/replays");
    if (!response.ok) throw new Error(await errorMessage(response, "Could not load replay history."));
    return replayHistorySchema.parse(await response.json());
  }

  async delete(id: string): Promise<void> {
    const response = await this.request(`/api/replays/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) throw new Error(await errorMessage(response, "Could not delete replay."));
  }
}
