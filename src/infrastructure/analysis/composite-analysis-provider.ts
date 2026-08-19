import type {
  AnalysisProvider,
  AnalysisResult,
  PlayerPredictionProvider,
  TeamAnalysisProvider,
} from "../../application/ports";

export class CompositeAnalysisProvider implements AnalysisProvider {
  constructor(
    private readonly teamProvider: TeamAnalysisProvider,
    private readonly predictionProvider: PlayerPredictionProvider,
  ) {}

  async analyze(parsedReplayPath: string): Promise<AnalysisResult> {
    const [teamResult, predictionResult] = await Promise.all([
      this.teamProvider.analyzeTeams(parsedReplayPath),
      this.predictionProvider.predictPlayers(parsedReplayPath),
    ]);
    return {
      provider: `${teamResult.provider}+${predictionResult.provider}`,
      modelVersion: teamResult.modelVersion,
      teams: teamResult.teams,
      playerPredictions: predictionResult.playerPredictions,
    };
  }
}
