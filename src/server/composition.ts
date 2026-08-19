import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { ProcessReplay } from "../application/process-replay";
import { ProcessReplayJob } from "../application/process-replay-job";
import { ExplainMistake } from "../application/explain-mistake";
import { AnalyzePlayerWeaknesses } from "../application/analyze-player-weaknesses";
import { ReplayAnalysisRunnerJsonAdapter } from "../infrastructure/analysis/replay-analysis-runner-json-adapter";
import { StoredReplayAnalysisJsonAdapter } from "../infrastructure/analysis/stored-replay-analysis-json-adapter";
import { OpenAiMistakeExplanationProvider } from "../infrastructure/ai/openai-mistake-explanation-provider";
import { OpenAiPlayerWeaknessesProvider } from "../infrastructure/ai/openai-player-weaknesses-provider";
import { SqliteReplayRepository } from "../infrastructure/replay/sqlite-replay-repository";
import { SqliteReplayJobRepository } from "../infrastructure/replay/sqlite-replay-job-repository";
import { RrrocketProcessAdapter } from "../infrastructure/replay/rrrocket-process-adapter";
import { LambdaReplayParser } from "../infrastructure/replay/lambda-replay-parser";
import { R2ObjectReader } from "../infrastructure/replay/r2-object-reader";
import { SupabaseReplayRepository } from "../infrastructure/replay/supabase-replay-repository";
import { SupabaseReplayJobRepository } from "../infrastructure/replay/supabase-replay-job-repository";
import { createReplayApiPlugin } from "./http/replay-api";

const ANALYSIS_TIMEOUT_MS = 10 * 60 * 1_000;

export function composeReplayApi(
  root = resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
  environment: Record<string, string | undefined> = process.env,
) {
  const modelRoot = resolve(root, "../rocket-league-prediction-model");
  const python = resolve(modelRoot, "prediction-model/.venv/bin/python");
  const databasePath = resolve(root, "input/replay-analysis.sqlite");
  const parserQueueUrl = environment.REPLAY_PARSER_QUEUE_URL?.trim();
  const parserSecretId = environment.REPLAY_PARSER_R2_SECRET_ID?.trim();
  const supabaseUrl = environment.SUPABASE_URL?.trim();
  const supabasePublishableKey = environment.SUPABASE_PUBLISHABLE_KEY?.trim();
  const supabaseSecretKey = environment.SUPABASE_SECRET_KEY?.trim();
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required for authentication.");
  }
  if (supabaseUrl && supabaseSecretKey && !parserSecretId) {
    throw new Error("REPLAY_PARSER_R2_SECRET_ID is required when Supabase persistence is configured.");
  }
  const awsRegion = environment.AWS_REGION?.trim() || "us-east-2";
  const awsProfile = environment.AWS_PROFILE?.trim() || undefined;
  const authClient = createClient(supabaseUrl, supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const supabase = supabaseSecretKey
    ? createClient(supabaseUrl, supabaseSecretKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      })
    : undefined;
  const repository = supabase && parserSecretId
    ? new SupabaseReplayRepository(supabase, new R2ObjectReader({
        secretId: parserSecretId,
        region: awsRegion,
        profile: awsProfile,
      }))
    : new SqliteReplayRepository(databasePath);
  const jobs = supabase
    ? new SupabaseReplayJobRepository(supabase)
    : new SqliteReplayJobRepository(databasePath);
  if (parserQueueUrl && !parserSecretId) {
    throw new Error("REPLAY_PARSER_R2_SECRET_ID is required when REPLAY_PARSER_QUEUE_URL is configured.");
  }
  const parser = parserQueueUrl && parserSecretId
    ? new LambdaReplayParser({
        queueUrl: parserQueueUrl,
        secretId: parserSecretId,
        region: awsRegion,
        profile: awsProfile,
        timeoutMs: Number(environment.REPLAY_PARSER_TIMEOUT_MS) || undefined,
        analysisTimeoutMs: Number(environment.REPLAY_ANALYSIS_TIMEOUT_MS) || undefined,
        pollIntervalMs: Number(environment.REPLAY_PARSER_POLL_INTERVAL_MS) || undefined,
      })
    : new RrrocketProcessAdapter({
        executable: resolve(modelRoot, "rrrocket"),
        cwd: modelRoot,
      });
  const processReplay = new ProcessReplay({
    parser,
    analysisProvider: parserQueueUrl
      ? new StoredReplayAnalysisJsonAdapter({
          modelVersion: environment.REPLAY_ANALYSIS_MODEL_VERSION?.trim() || undefined,
        })
      : new ReplayAnalysisRunnerJsonAdapter({
          python,
          module: "replay_analysis_service",
          cwd: modelRoot,
          device: environment.REPLAY_ANALYSIS_DEVICE?.trim() || (process.platform === "darwin" ? "cpu" : "auto"),
          timeoutMs: ANALYSIS_TIMEOUT_MS,
        }),
    repository,
    createId: randomUUID,
    now: () => new Date(),
  });
  const processReplayJob = new ProcessReplayJob({
    processReplay,
    jobs,
    createId: randomUUID,
    now: () => new Date(),
  });
  const apiKey = environment.OPENAI_API_KEY?.trim();
  const explainMistake = new ExplainMistake({
    repository,
    provider: apiKey ? new OpenAiMistakeExplanationProvider({
      apiKey,
      model: environment.OPENAI_MISTAKE_MODEL?.trim() || "gpt-5.6-luna",
      timeoutMs: Number(environment.OPENAI_MISTAKE_TIMEOUT_MS) || 30_000,
    }) : undefined,
    now: () => new Date(),
  });
  const analyzePlayerWeaknesses = new AnalyzePlayerWeaknesses({
    repository,
    provider: apiKey ? new OpenAiPlayerWeaknessesProvider({
      apiKey,
      model: environment.OPENAI_MISTAKE_MODEL?.trim() || "gpt-5.6-luna",
      timeoutMs: Number(environment.OPENAI_MISTAKE_TIMEOUT_MS) || 30_000,
    }) : undefined,
    now: () => new Date(),
  });
  return createReplayApiPlugin(processReplayJob, repository, explainMistake, analyzePlayerWeaknesses, async request => {
    const authorization = request.headers.authorization;
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    if (!match) return undefined;
    const { data, error } = await authClient.auth.getUser(match[1]);
    return error ? undefined : data.user?.id;
  });
}
