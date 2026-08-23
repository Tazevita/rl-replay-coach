import type {
  MistakeExplanation,
  PlayerMistake,
  PlayerMistakesResponse,
  PlayerWeaknessesContent,
} from "../shared/contracts/player-mistakes";
import type { PlayerPredictions, ReplayAnalysisBundleV2, TeamAnalysis } from "../shared/contracts/replay-analysis-v2";
import type { RrrocketReplay } from "../shared/contracts/rrrocket";
import type { ReplayJob, ReplayJobStatus } from "../shared/contracts/replay-job";
import type { ReplayHistoryItem } from "../shared/contracts/replay-history";

export interface ReplaySource {
  filename: string;
  path: string;
  contentHash: string;
  createdBy: string;
  dispose(): Promise<void>;
}

export interface ParsedReplay {
  data: RrrocketReplay;
  analysisInputPath: string;
  objectKey?: string;
  dispose(): Promise<void>;
}

export interface ReplayParser {
  parse(sourcePath: string): Promise<ParsedReplay>;
}

export interface AnalysisResult {
  provider: string;
  modelVersion?: string;
  teams: TeamAnalysis[];
  playerPredictions: PlayerPredictions;
}

export interface AnalysisProvider {
  analyze(parsedReplayPath: string): Promise<AnalysisResult>;
}

export interface TeamAnalysisResult {
  provider: string;
  modelVersion?: string;
  teams: TeamAnalysis[];
}

export interface TeamAnalysisProvider {
  analyzeTeams(parsedReplayPath: string): Promise<TeamAnalysisResult>;
}

export interface PredictionAnalysisResult {
  provider: string;
  playerPredictions: PlayerPredictions;
}

export interface PlayerPredictionProvider {
  predictPlayers(parsedReplayPath: string): Promise<PredictionAnalysisResult>;
}

export interface ReplayRepository {
  listReplays(createdBy: string): Promise<ReplayHistoryItem[]>;
  deleteReplay(id: string, createdBy: string): Promise<boolean>;
  findBundleByHash(createdBy: string, contentHash: string): Promise<ReplayAnalysisBundleV2 | undefined>;
  publish(record: {
    id: string;
    contentHash: string;
    createdBy: string;
    filename: string;
    replay: RrrocketReplay;
    replayObjectKey?: string;
    bundle: ReplayAnalysisBundleV2;
  }): Promise<ReplayAnalysisBundleV2>;
  getReplay(id: string, createdBy: string): Promise<RrrocketReplay | undefined>;
  getBundle(id: string, createdBy: string): Promise<ReplayAnalysisBundleV2 | undefined>;
  getPlayerMistakes(username: string, createdBy: string, replayLimit: number): Promise<PlayerMistakesResponse>;
  getMistake(id: string, createdBy: string): Promise<PlayerMistake | undefined>;
  saveMistakeExplanation(id: string, createdBy: string, explanation: MistakeExplanation): Promise<MistakeExplanation | undefined>;
}

export interface ReplayJobRepository {
  create(record: { id: string; createdBy: string; createdAt: string }): Promise<void>;
  setStatus(id: string, createdBy: string, status: ReplayJobStatus, updatedAt: string): Promise<void>;
  complete(id: string, createdBy: string, result: ReplayAnalysisBundleV2, updatedAt: string): Promise<void>;
  fail(id: string, createdBy: string, error: string, updatedAt: string): Promise<void>;
  get(id: string, createdBy: string): Promise<ReplayJob | undefined>;
}

export interface MistakeExplanationProvider {
  explain(mistake: PlayerMistake): Promise<{ text: string; model: string }>;
}

export interface PlayerWeaknessesProvider {
  analyze(player: PlayerMistakesResponse): Promise<{ content: PlayerWeaknessesContent; model: string }>;
}

export interface SupportRequestRepository {
  create(record: {
    id: string;
    createdBy: string;
    email: string;
    subject: string;
    message: string;
    createdAt: string;
  }): Promise<void>;
}
