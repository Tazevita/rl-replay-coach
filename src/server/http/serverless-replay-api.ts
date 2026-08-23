import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { fromIni } from "@aws-sdk/credential-providers";
import { createClient } from "@supabase/supabase-js";
import { FinalizeReplayUpload } from "../../application/finalize-replay-upload";
import { assertReplayCapacity, ReplayLimitReachedError } from "../../application/replay-upload-limit";
import { AnalyzePlayerWeaknesses } from "../../application/analyze-player-weaknesses";
import { ExplainMistake } from "../../application/explain-mistake";
import { OpenAiMistakeExplanationProvider } from "../../infrastructure/ai/openai-mistake-explanation-provider";
import { OpenAiPlayerWeaknessesProvider } from "../../infrastructure/ai/openai-player-weaknesses-provider";
import { awsCredentialOptions } from "../../infrastructure/aws-credentials";
import { R2ObjectReader } from "../../infrastructure/replay/r2-object-reader";
import { SupabaseReplayJobRepository } from "../../infrastructure/replay/supabase-replay-job-repository";
import { SupabaseReplayRepository } from "../../infrastructure/replay/supabase-replay-repository";
import { SupabaseSupportRequestRepository } from "../../infrastructure/support/supabase-support-request-repository";
import { replayParserJobSchema } from "../../shared/contracts/replay-parser-job";
import { replayUploadCreatedSchema, replayUploadRequestSchema } from "../../shared/contracts/replay-upload";
import { createReplayHttpHandler, type AuthenticateRequest } from "./replay-api";

const JSON_BODY_LIMIT = 16 * 1024;
const LEASE_MS = 60_000;

function required(value: string | undefined, name: string): string {
  const result = value?.trim();
  if (!result) throw new Error(`${name} is required.`);
  return result;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > JSON_BODY_LIMIT) throw new Error("Request body is too large.");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function decodePathId(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

export function createServerlessReplayApi(environment: Record<string, string | undefined> = process.env) {
  const supabaseUrl = required(environment.SUPABASE_URL || environment.VITE_SUPABASE_URL, "SUPABASE_URL or VITE_SUPABASE_URL");
  const publishableKey = required(
    environment.SUPABASE_PUBLISHABLE_KEY || environment.VITE_SUPABASE_PUBLISHABLE_KEY,
    "SUPABASE_PUBLISHABLE_KEY or VITE_SUPABASE_PUBLISHABLE_KEY",
  );
  const secretKey = required(environment.SUPABASE_SECRET_KEY, "SUPABASE_SECRET_KEY");
  const queueUrl = required(environment.REPLAY_PARSER_QUEUE_URL, "REPLAY_PARSER_QUEUE_URL");
  const r2SecretId = required(environment.REPLAY_PARSER_R2_SECRET_ID, "REPLAY_PARSER_R2_SECRET_ID");
  const awsRegion = environment.AWS_REGION?.trim() || "us-east-2";
  const aws = awsCredentialOptions(environment);
  const credentials = aws.credentials ?? (aws.profile ? fromIni({ profile: aws.profile }) : undefined);
  const queue = new SQSClient({ region: awsRegion, credentials });
  const authClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const supabase = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const objects = new R2ObjectReader({ secretId: r2SecretId, region: awsRegion, ...aws });
  const repository = new SupabaseReplayRepository(supabase, objects);
  const jobs = new SupabaseReplayJobRepository(supabase);
  const supportRequests = new SupabaseSupportRequestRepository(supabase);
  const finalizer = new FinalizeReplayUpload({
    repository,
    outputs: objects,
    createId: randomUUID,
    now: () => new Date(),
    modelVersion: environment.REPLAY_ANALYSIS_MODEL_VERSION?.trim() || undefined,
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
  const authenticate: AuthenticateRequest = async request => {
    const match = request.headers.authorization?.match(/^Bearer\s+(.+)$/i);
    if (!match) return undefined;
    const { data, error } = await authClient.auth.getUser(match[1]);
    const user = data.user;
    return error || !user?.email ? undefined : { id: user.id, email: user.email };
  };
  const fallback = createReplayHttpHandler(
    { submit: async () => { throw new Error("Direct replay upload is required."); }, get: (id, createdBy) => jobs.get(id, createdBy) },
    repository,
    explainMistake,
    analyzePlayerWeaknesses,
    authenticate,
    supportRequests,
  );

  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    const user = await authenticate(request);
    if (!user) return sendJson(response, 401, { error: "Sign in to continue." });
    const createdBy = user.id;

    if (request.method === "POST" && requestUrl.pathname === "/api/replay-uploads") {
      try {
        const upload = replayUploadRequestSchema.parse(await readJson(request));
        if (basename(upload.filename) !== upload.filename || upload.filename.includes("\\") || !upload.filename.toLowerCase().endsWith(".replay")) {
          return sendJson(response, 400, { error: "Choose a valid .replay file." });
        }
        const id = randomUUID();
        const now = new Date().toISOString();
        const statusUrl = `/api/replay-jobs/${encodeURIComponent(id)}`;
        const existing = await repository.findBundleByHash(createdBy, upload.sha256);
        if (!existing) await assertReplayCapacity(repository, createdBy);
        const sourceObjectKey = `jobs/${id}/source.replay`;
        await jobs.createUpload({
          id,
          createdBy,
          filename: upload.filename,
          contentHash: upload.sha256,
          uploadBytes: upload.size,
          sourceObjectKey,
          parsedObjectKey: `jobs/${id}/parsed/replay-v0.11.5.json`,
          analysisObjectKey: `jobs/${id}/analysis/replay-analysis-v1.json`,
          createdAt: now,
        });
        if (existing) {
          await jobs.complete(id, createdBy, existing, now);
          return sendJson(response, 200, replayUploadCreatedSchema.parse({ jobId: id, status: "completed", statusUrl }));
        }
        const signed = await objects.createUploadUrl(sourceObjectKey, upload.sha256);
        return sendJson(response, 201, replayUploadCreatedSchema.parse({
          jobId: id,
          status: "uploading",
          statusUrl,
          dispatchUrl: `${statusUrl}/dispatch`,
          uploadUrl: signed.url,
          uploadHeaders: signed.headers,
        }));
      } catch (error) {
        return sendJson(response, error instanceof ReplayLimitReachedError ? 409 : 400, { error: error instanceof Error ? error.message : "Could not initialize replay upload." });
      }
    }

    const dispatchMatch = requestUrl.pathname.match(/^\/api\/replay-jobs\/([^/]+)\/dispatch$/);
    if (request.method === "POST" && dispatchMatch) {
      const id = decodePathId(dispatchMatch[1]);
      const job = id ? await jobs.getUpload(id, createdBy) : undefined;
      if (!id || !job) return sendJson(response, 404, { error: "Replay job not found." });
      if (job.status !== "queued") return sendJson(response, 202, await jobs.get(id, createdBy));
      const uploaded = await objects.metadata(job.sourceObjectKey);
      if (!uploaded || uploaded.size !== job.uploadBytes || uploaded.sha256 !== job.contentHash) {
        return sendJson(response, 409, { error: "The uploaded replay could not be verified." });
      }
      const now = new Date();
      const claimed = await jobs.claimDispatch(id, createdBy, now.toISOString(), new Date(now.getTime() - LEASE_MS).toISOString());
      if (!claimed) return sendJson(response, 202, await jobs.get(id, createdBy));
      try {
        const message = replayParserJobSchema.parse({
          jobId: id,
          sourceKey: job.sourceObjectKey,
          outputKey: job.parsedObjectKey,
          analysisOutputKey: job.analysisObjectKey,
        });
        await queue.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(message) }));
        await jobs.markDispatched(id, createdBy, now.toISOString());
        return sendJson(response, 202, await jobs.get(id, createdBy));
      } catch (error) {
        await jobs.releaseDispatch(id, createdBy).catch(() => undefined);
        return sendJson(response, 502, { error: error instanceof Error ? error.message : "Could not queue replay processing." });
      }
    }

    const jobMatch = requestUrl.pathname.match(/^\/api\/replay-jobs\/([^/]+)$/);
    if (request.method === "GET" && jobMatch) {
      const id = decodePathId(jobMatch[1]);
      const current = id ? await jobs.get(id, createdBy) : undefined;
      if (!id || !current) return sendJson(response, 404, { error: "Replay job not found." });
      if (current.status !== "processing") return sendJson(response, 200, current);
      const upload = await jobs.getUpload(id, createdBy);
      if (!upload) return sendJson(response, 200, current);
      const [parsed, analysis] = await Promise.all([
        objects.metadata(upload.parsedObjectKey),
        objects.metadata(upload.analysisObjectKey),
      ]);
      if (!parsed || !analysis) return sendJson(response, 200, current);
      const now = new Date();
      const claimed = await jobs.claimFinalization(id, createdBy, now.toISOString(), new Date(now.getTime() - LEASE_MS).toISOString());
      if (!claimed) return sendJson(response, 200, current);
      try {
        const result = await finalizer.execute(upload);
        await jobs.complete(id, createdBy, result, new Date().toISOString());
      } catch (error) {
        const message = error instanceof Error ? error.message : "Replay processing failed.";
        await jobs.fail(id, createdBy, message, new Date().toISOString());
      }
      return sendJson(response, 200, await jobs.get(id, createdBy));
    }

    const dataMatch = requestUrl.pathname.match(/^\/api\/replays\/([^/]+)\/data$/);
    if (request.method === "GET" && dataMatch) {
      const id = decodePathId(dataMatch[1]);
      const objectKey = id ? await repository.getReplayObjectKey(id, createdBy) : undefined;
      if (!objectKey) return sendJson(response, 404, { error: "Replay not found." });
      response.statusCode = 307;
      response.setHeader("Location", await objects.createReadUrl(objectKey));
      response.end();
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/replays") {
      return sendJson(response, 410, { error: "Refresh the application to use direct replay uploads." });
    }

    await fallback(request, response, () => sendJson(response, 404, { error: "Not found." }));
  };
}
