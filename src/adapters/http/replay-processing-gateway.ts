import { replayAnalysisBundleV2Schema, type ReplayAnalysisBundleV2 } from "../../shared/contracts/replay-analysis-v2";
import { replayJobSchema } from "../../shared/contracts/replay-job";
import { replayJobCreatedSchema } from "../../shared/contracts/replay-job";
import { replayUploadCreatedSchema } from "../../shared/contracts/replay-upload";
import type { ReplayProcessingGateway, ReplayUpload } from "../../application/controllers/replay-viewer-controller";

const defaultFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

export class HttpReplayProcessingGateway implements ReplayProcessingGateway {
  constructor(
    private readonly pollIntervalMs = 1_000,
    private readonly sleep: (milliseconds: number) => Promise<void> = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
    private readonly request: typeof fetch = defaultFetch,
    private readonly uploadRequest: typeof fetch = defaultFetch,
  ) {}

  async process(upload: ReplayUpload): Promise<ReplayAnalysisBundleV2> {
    if (!(upload.content instanceof Blob)) throw new Error("Replay upload content is unavailable.");
    const sha256 = await digestSha256(upload.content);
    const response = await this.request("/api/replay-uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: upload.name, size: upload.content.size, sha256 }),
    });
    if (response.status === 404) return this.processLegacy(upload.name, upload.content);
    const result: unknown = await response.json();
    if (!response.ok) {
      throw new Error(errorMessage(result));
    }
    const created = replayUploadCreatedSchema.parse(result);
    if (created.status === "uploading") {
      const uploaded = await this.uploadRequest(created.uploadUrl, {
        method: "PUT",
        headers: created.uploadHeaders,
        body: upload.content,
      });
      if (!uploaded.ok) throw new Error("Could not upload the replay to storage.");
      const dispatched = await this.request(created.dispatchUrl, { method: "POST" });
      if (!dispatched.ok) throw new Error(errorMessage(await dispatched.json()));
    }
    return this.poll(created.statusUrl, created.status === "uploading" ? created.dispatchUrl : undefined);
  }

  private async processLegacy(filename: string, content: Blob): Promise<ReplayAnalysisBundleV2> {
    const response = await this.request("/api/replays", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "X-Replay-Filename": encodeURIComponent(filename) },
      body: content,
    });
    const result: unknown = await response.json();
    if (!response.ok) throw new Error(errorMessage(result));
    return this.poll(replayJobCreatedSchema.parse(result).statusUrl);
  }

  private async poll(statusUrl: string, dispatchUrl?: string): Promise<ReplayAnalysisBundleV2> {
    while (true) {
      await this.sleep(this.pollIntervalMs);
      const statusResponse = await this.request(statusUrl);
      const statusResult: unknown = await statusResponse.json();
      if (!statusResponse.ok) throw new Error(errorMessage(statusResult));
      const job = replayJobSchema.parse(statusResult);
      if (job.status === "queued" && dispatchUrl) {
        const dispatched = await this.request(dispatchUrl, { method: "POST" });
        if (!dispatched.ok) throw new Error(errorMessage(await dispatched.json()));
      }
      if (job.status === "completed") return replayAnalysisBundleV2Schema.parse(job.result);
      if (job.status === "failed") throw new Error(job.error);
    }
  }
}

async function digestSha256(content: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await content.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function errorMessage(result: unknown): string {
  return typeof result === "object" && result && "error" in result
    ? String(result.error)
    : "Replay processing failed.";
}
