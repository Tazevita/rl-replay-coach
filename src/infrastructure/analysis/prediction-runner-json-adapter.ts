import { z } from "zod";
import type { PlayerPredictionProvider, PredictionAnalysisResult } from "../../application/ports";
import { playerPredictionsSchema } from "../../shared/contracts/replay-analysis-v2";
import { runProcess, type ProcessRunner } from "../process/run-process";

export const predictionRunnerJsonSchema = playerPredictionsSchema.extend({
  schemaVersion: z.literal(1),
});

export interface PredictionRunnerJsonAdapterOptions {
  python: string;
  script: string;
  cwd: string;
  provider?: string;
  timeoutMs?: number;
  run?: ProcessRunner;
}

export class PredictionRunnerJsonAdapter implements PlayerPredictionProvider {
  constructor(private readonly options: PredictionRunnerJsonAdapterOptions) {}

  async predictPlayers(parsedReplayPath: string): Promise<PredictionAnalysisResult> {
    const stdout = await (this.options.run ?? runProcess)({
      command: this.options.python,
      args: [this.options.script, parsedReplayPath, "--format", "json"],
      cwd: this.options.cwd,
      ...(this.options.timeoutMs === undefined ? {} : { timeoutMs: this.options.timeoutMs }),
    });

    try {
      const { schemaVersion: _, ...playerPredictions } = predictionRunnerJsonSchema.parse(JSON.parse(stdout));
      return {
        provider: this.options.provider ?? "prediction-runner-json",
        playerPredictions,
      };
    } catch (error) {
      throw new Error("Prediction runner returned malformed JSON.", { cause: error });
    }
  }
}
