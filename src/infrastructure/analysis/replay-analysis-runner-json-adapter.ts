import { z } from "zod";
import type { AnalysisProvider, AnalysisResult } from "../../application/ports";
import { playerPredictionsSchema, teamAnalysisSchema } from "../../shared/contracts/replay-analysis-v2";
import { runProcess, type ProcessRunner } from "../process/run-process";

export const replayAnalysisRunnerJsonSchema = z.object({
  schemaVersion: z.literal(1),
  teams: z.array(teamAnalysisSchema).min(1),
  playerPredictions: playerPredictionsSchema,
});

export interface ReplayAnalysisRunnerJsonAdapterOptions {
  python: string;
  module: string;
  cwd: string;
  provider?: string;
  modelVersion?: string;
  device?: string;
  timeoutMs?: number;
  run?: ProcessRunner;
}

export class ReplayAnalysisRunnerJsonAdapter implements AnalysisProvider {
  constructor(private readonly options: ReplayAnalysisRunnerJsonAdapterOptions) {}

  async analyze(parsedReplayPath: string): Promise<AnalysisResult> {
    const run = this.options.run ?? runProcess;
    const stdout = await run({
      command: this.options.python,
      args: [
        "-m",
        this.options.module,
        parsedReplayPath,
        "--all-teams",
        "--prediction-interval",
        "1",
        ...(this.options.device ? ["--device", this.options.device] : []),
      ],
      cwd: this.options.cwd,
      ...(this.options.timeoutMs === undefined ? {} : { timeoutMs: this.options.timeoutMs }),
    });
    try {
      const { teams, playerPredictions } = replayAnalysisRunnerJsonSchema.parse(JSON.parse(stdout));
      return {
        provider: this.options.provider ?? "replay-analysis-runner-json",
        modelVersion: this.options.modelVersion,
        teams,
        playerPredictions,
      };
    } catch (error) {
      throw new Error("Replay analysis runner returned malformed JSON.", { cause: error });
    }
  }
}
