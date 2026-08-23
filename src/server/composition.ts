import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { ProcessReplay } from "../application/process-replay";
import { ProcessReplayJob } from "../application/process-replay-job";
import { ExplainMistake } from "../application/explain-mistake";
import { AnalyzePlayerWeaknesses } from "../application/analyze-player-weaknesses";
import { ReplayAnalysisRunnerJsonAdapter } from "../infrastructure/analysis/replay-analysis-runner-json-adapter";
import { StoredReplayAnalysisJsonAdapter } from "../infrastructure/analysis/stored-replay-analysis-json-adapter";
import { OpenAiMistakeExplanationProvider } from "../infrastructure/ai/openai-mistake-explanation-provider";
import { OpenAiPlayerWeaknessesProvider } from "../infrastructure/ai/openai-player-weaknesses-provider";
import { awsCredentialOptions } from "../infrastructure/aws-credentials";
import { RrrocketProcessAdapter } from "../infrastructure/replay/rrrocket-process-adapter";
import { LambdaReplayParser } from "../infrastructure/replay/lambda-replay-parser";
import { R2ObjectReader } from "../infrastructure/replay/r2-object-reader";
import { SupabaseReplayRepository } from "../infrastructure/replay/supabase-replay-repository";
import { SupabaseReplayJobRepository } from "../infrastructure/replay/supabase-replay-job-repository";
import { PrismaReplayRepository } from "../infrastructure/replay/prisma-replay-repository";
import { PrismaReplayJobRepository } from "../infrastructure/replay/prisma-replay-job-repository";
import { PrismaSupportRequestRepository } from "../infrastructure/support/prisma-support-request-repository";
import { SupabaseSupportRequestRepository } from "../infrastructure/support/supabase-support-request-repository";
import { createReplayApiPlugin } from "./http/replay-api";

const ANALYSIS_TIMEOUT_MS = 10 * 60 * 1_000;

function enabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function localDatabase(root: string, environment: Record<string, string | undefined>): PrismaClient {
  const dataRoot = resolve(root, environment.TEST_DATA_DIR?.trim() || ".local-data");
  const databasePath = resolve(dataRoot, "replay-coach.sqlite");
  const databaseUrl = `file:${databasePath}`;
  mkdirSync(dataRoot, { recursive: true });
  execFileSync(process.execPath, [resolve(root, "node_modules/prisma/build/index.js"), "db", "push", "--skip-generate"], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "inherit",
  });
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

export function composeReplayApi(
  root = resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
  environment: Record<string, string | undefined> = process.env,
) {
  const modelRoot = resolve(root, "../rocket-league-prediction-model");
  const python = resolve(modelRoot, "prediction-model/.venv/bin/python");
  const apiKey = environment.OPENAI_API_KEY?.trim();
  const openAiOptions = apiKey ? {
    apiKey,
    model: environment.OPENAI_MISTAKE_MODEL?.trim() || "gpt-5.6-luna",
    timeoutMs: Number(environment.OPENAI_MISTAKE_TIMEOUT_MS) || 30_000,
  } : undefined;
  if (enabled(environment.TEST_MODE)) {
    const dataRoot = resolve(root, environment.TEST_DATA_DIR?.trim() || ".local-data");
    const client = localDatabase(root, environment);
    const repository = new PrismaReplayRepository(client, resolve(dataRoot, "replays"));
    const jobs = new PrismaReplayJobRepository(client);
    const supportRequests = new PrismaSupportRequestRepository(client);
    const processReplay = new ProcessReplay({
      parser: new RrrocketProcessAdapter({ executable: resolve(modelRoot, "rrrocket"), cwd: modelRoot }),
      analysisProvider: new ReplayAnalysisRunnerJsonAdapter({
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
    const processReplayJob = new ProcessReplayJob({ processReplay, jobs, createId: randomUUID, now: () => new Date() });
    const explainMistake = new ExplainMistake({
      repository,
      provider: openAiOptions ? new OpenAiMistakeExplanationProvider(openAiOptions) : undefined,
      now: () => new Date(),
    });
    const analyzePlayerWeaknesses = new AnalyzePlayerWeaknesses({
      repository,
      provider: openAiOptions ? new OpenAiPlayerWeaknessesProvider(openAiOptions) : undefined,
      now: () => new Date(),
    });
    const localUser = environment.TEST_USER_ID?.trim() || "local-test-user";
    const localEmail = environment.TEST_USER_EMAIL?.trim() || "local@test.invalid";
    return createReplayApiPlugin(processReplayJob, repository, explainMistake, analyzePlayerWeaknesses, async () => ({ id: localUser, email: localEmail }), supportRequests);
  }
  const parserQueueUrl = environment.REPLAY_PARSER_QUEUE_URL?.trim();
  const parserSecretId = environment.REPLAY_PARSER_R2_SECRET_ID?.trim();
  const supabaseUrl = environment.SUPABASE_URL?.trim();
  const supabasePublishableKey = environment.SUPABASE_PUBLISHABLE_KEY?.trim();
  const supabaseSecretKey = environment.SUPABASE_SECRET_KEY?.trim();
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required for authentication.");
  }
  if (!supabaseSecretKey || !parserSecretId) {
    throw new Error("SUPABASE_SECRET_KEY and REPLAY_PARSER_R2_SECRET_ID are required for replay persistence.");
  }
  const awsRegion = environment.AWS_REGION?.trim() || "us-east-2";
  const aws = awsCredentialOptions(environment);
  const authClient = createClient(supabaseUrl, supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const repository = new SupabaseReplayRepository(supabase, new R2ObjectReader({
    secretId: parserSecretId,
    region: awsRegion,
    ...aws,
  }));
  const jobs = new SupabaseReplayJobRepository(supabase);
  const supportRequests = new SupabaseSupportRequestRepository(supabase);
  const parser = parserQueueUrl && parserSecretId
    ? new LambdaReplayParser({
        queueUrl: parserQueueUrl,
        secretId: parserSecretId,
        region: awsRegion,
        ...aws,
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
  const explainMistake = new ExplainMistake({
    repository,
    provider: openAiOptions ? new OpenAiMistakeExplanationProvider(openAiOptions) : undefined,
    now: () => new Date(),
  });
  const analyzePlayerWeaknesses = new AnalyzePlayerWeaknesses({
    repository,
    provider: openAiOptions ? new OpenAiPlayerWeaknessesProvider(openAiOptions) : undefined,
    now: () => new Date(),
  });
  return createReplayApiPlugin(processReplayJob, repository, explainMistake, analyzePlayerWeaknesses, async request => {
    const authorization = request.headers.authorization;
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    if (!match) return undefined;
    const { data, error } = await authClient.auth.getUser(match[1]);
    const user = data.user;
    return error || !user?.email ? undefined : { id: user.id, email: user.email };
  }, supportRequests);
}
