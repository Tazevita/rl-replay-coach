import type { ReplayRepository } from "./ports";
import { replayAnalysisRunnerJsonSchema } from "../infrastructure/analysis/replay-analysis-runner-json-adapter";
import { replayAnalysisBundleV2Schema, type ReplayAnalysisBundleV2 } from "../shared/contracts/replay-analysis-v2";
import { rrrocketReplaySchema } from "../shared/contracts/rrrocket";
import { assertReplayCapacity } from "./replay-upload-limit";

export interface ReplayOutputReader {
  read(objectKey: string): Promise<unknown>;
}

export class FinalizeReplayUpload {
  constructor(private readonly dependencies: {
    repository: ReplayRepository;
    outputs: ReplayOutputReader;
    createId(): string;
    now(): Date;
    modelVersion?: string;
  }) {}

  async execute(job: {
    createdBy: string;
    filename: string;
    contentHash: string;
    parsedObjectKey: string;
    analysisObjectKey: string;
  }): Promise<ReplayAnalysisBundleV2> {
    const existing = await this.dependencies.repository.findBundleByHash(job.createdBy, job.contentHash);
    if (existing) return existing;
    await assertReplayCapacity(this.dependencies.repository, job.createdBy);

    const [replayValue, analysisValue] = await Promise.all([
      this.dependencies.outputs.read(job.parsedObjectKey),
      this.dependencies.outputs.read(job.analysisObjectKey),
    ]);
    if (isAnalysisFailure(analysisValue)) throw new Error(analysisValue.error);
    const replay = rrrocketReplaySchema.parse(replayValue);
    const analysis = replayAnalysisRunnerJsonSchema.parse(analysisValue);
    const id = this.dependencies.createId();
    const bundle = replayAnalysisBundleV2Schema.parse({
      schemaVersion: 2,
      replay: {
        id,
        filename: job.filename,
        dataUrl: `/api/replays/${encodeURIComponent(id)}/data`,
        timebase: { unit: "seconds", origin: "replay-start" },
      },
      analysis: {
        provider: "aws-lambda-replay-analysis",
        modelVersion: this.dependencies.modelVersion,
        generatedAt: this.dependencies.now().toISOString(),
        teams: analysis.teams,
        playerPredictions: analysis.playerPredictions,
      },
    });
    return this.dependencies.repository.publish({
      id,
      contentHash: job.contentHash,
      createdBy: job.createdBy,
      filename: job.filename,
      replay,
      replayObjectKey: job.parsedObjectKey,
      bundle,
    });
  }
}

function isAnalysisFailure(value: unknown): value is { status: "failed"; error: string } {
  return typeof value === "object"
    && value !== null
    && "status" in value
    && value.status === "failed"
    && "error" in value
    && typeof value.error === "string"
    && value.error.length > 0;
}
