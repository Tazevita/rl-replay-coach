import type { AnalysisProvider, ReplayParser, ReplayRepository, ReplaySource } from "./ports";
import { replayAnalysisBundleV2Schema, type ReplayAnalysisBundleV2 } from "../shared/contracts/replay-analysis-v2";
import { rrrocketReplaySchema } from "../shared/contracts/rrrocket";

export interface ProcessReplayDependencies {
  parser: ReplayParser;
  analysisProvider: AnalysisProvider;
  repository: ReplayRepository;
  createId(): string;
  now(): Date;
}

export class ProcessReplay {
  constructor(private readonly dependencies: ProcessReplayDependencies) {}

  async execute(source: ReplaySource): Promise<ReplayAnalysisBundleV2> {
    let parsed: Awaited<ReturnType<ReplayParser["parse"]>> | undefined;
    try {
      const existing = await this.dependencies.repository.findBundleByHash(source.createdBy, source.contentHash);
      if (existing) return existing;
      parsed = await this.dependencies.parser.parse(source.path);
      const replay = rrrocketReplaySchema.parse(parsed.data);
      const analysis = await this.dependencies.analysisProvider.analyze(parsed.analysisInputPath);
      const id = this.dependencies.createId();
      const bundle = replayAnalysisBundleV2Schema.parse({
        schemaVersion: 2,
        replay: {
          id,
          filename: source.filename,
          dataUrl: `/api/replays/${encodeURIComponent(id)}/data`,
          timebase: { unit: "seconds", origin: "replay-start" },
        },
        analysis: {
          provider: analysis.provider,
          modelVersion: analysis.modelVersion,
          generatedAt: this.dependencies.now().toISOString(),
          teams: analysis.teams,
          playerPredictions: analysis.playerPredictions,
        },
      });
      return await this.dependencies.repository.publish({
        id,
        contentHash: source.contentHash,
        createdBy: source.createdBy,
        filename: source.filename,
        replay,
        replayObjectKey: parsed.objectKey,
        bundle,
      });
    } finally {
      await Promise.allSettled([parsed?.dispose(), source.dispose()].filter(Boolean) as Promise<void>[]);
    }
  }
}
