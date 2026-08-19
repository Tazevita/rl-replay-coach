import { readFile } from "node:fs/promises";
import type { AnalysisProvider, AnalysisResult } from "../../application/ports";
import { replayAnalysisRunnerJsonSchema } from "./replay-analysis-runner-json-adapter";

export interface StoredReplayAnalysisJsonAdapterOptions {
  provider?: string;
  modelVersion?: string;
}

export class StoredReplayAnalysisJsonAdapter implements AnalysisProvider {
  constructor(private readonly options: StoredReplayAnalysisJsonAdapterOptions = {}) {}

  async analyze(analysisPath: string): Promise<AnalysisResult> {
    try {
      const value = replayAnalysisRunnerJsonSchema.parse(JSON.parse(await readFile(analysisPath, "utf8")));
      return {
        provider: this.options.provider ?? "aws-lambda-replay-analysis",
        modelVersion: this.options.modelVersion,
        teams: value.teams,
        playerPredictions: value.playerPredictions,
      };
    } catch (error) {
      throw new Error("Stored replay analysis returned malformed JSON.", { cause: error });
    }
  }
}
