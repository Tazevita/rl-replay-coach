import { replayAnalysisBundleV2Schema, type ReplayAnalysisBundleV2 } from "../../shared/contracts/replay-analysis-v2";
import { replayJobCreatedSchema, replayJobSchema } from "../../shared/contracts/replay-job";
import type { ReplayProcessingGateway, ReplayUpload } from "../../application/controllers/replay-viewer-controller";

export class HttpReplayProcessingGateway implements ReplayProcessingGateway {
  constructor(
    private readonly pollIntervalMs = 1_000,
    private readonly sleep: (milliseconds: number) => Promise<void> = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
    private readonly request: typeof fetch = fetch,
  ) {}

  async process(upload: ReplayUpload): Promise<ReplayAnalysisBundleV2> {
    const response = await this.request("/api/replays", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Replay-Filename": encodeURIComponent(upload.name),
      },
      body: upload.content as BodyInit,
    });
    const result: unknown = await response.json();
    if (!response.ok) {
      throw new Error(errorMessage(result));
    }
    const created = replayJobCreatedSchema.parse(result);
    while (true) {
      await this.sleep(this.pollIntervalMs);
      const statusResponse = await this.request(created.statusUrl);
      const statusResult: unknown = await statusResponse.json();
      if (!statusResponse.ok) throw new Error(errorMessage(statusResult));
      const job = replayJobSchema.parse(statusResult);
      if (job.status === "completed") return replayAnalysisBundleV2Schema.parse(job.result);
      if (job.status === "failed") throw new Error(job.error);
    }
  }
}

function errorMessage(result: unknown): string {
  return typeof result === "object" && result && "error" in result
    ? String(result.error)
    : "Replay processing failed.";
}
