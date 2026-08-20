import { createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import type { Plugin } from "vite";
import type { ProcessReplayJob } from "../../application/process-replay-job";
import {
  AnalyzePlayerWeaknesses,
  PlayerWeaknessesNotFoundError,
  PlayerWeaknessesUnavailableError,
} from "../../application/analyze-player-weaknesses";
import {
  ExplainMistake,
  MistakeContextUnavailableError,
  MistakeExplanationUnavailableError,
  MistakeNotFoundError,
} from "../../application/explain-mistake";
import type { ReplayRepository, ReplaySource } from "../../application/ports";
import { replayJobCreatedSchema } from "../../shared/contracts/replay-job";

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
type Next = (error?: unknown) => void;
export type AuthenticateRequest = (request: IncomingMessage) => Promise<string | undefined>;

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(body));
}

function replayLimit(requestUrl: URL): number | undefined {
  const value = Number(requestUrl.searchParams.get("replays"));
  return Number.isInteger(value) && value >= 1 && value <= 50 ? value : undefined;
}

async function receiveUpload(request: IncomingMessage, filename: string, createdBy: string): Promise<ReplaySource> {
  const directory = await mkdtemp(join(tmpdir(), "replay-upload-"));
  const path = join(directory, "upload.replay");
  try {
    const hash = createHash("sha256");
    const hashStream = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(request, hashStream, createWriteStream(path));
    return {
      filename,
      path,
      contentHash: hash.digest("hex"),
      createdBy,
      dispose: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export function createReplayHttpHandler(
  processReplayJob: Pick<ProcessReplayJob, "submit" | "get">,
  repository: ReplayRepository,
  explainMistake: Pick<ExplainMistake, "execute">,
  analyzePlayerWeaknesses: Pick<AnalyzePlayerWeaknesses, "execute">,
  authenticate: AuthenticateRequest,
) {
  return async (request: IncomingMessage, response: ServerResponse, next: Next): Promise<void> => {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    if (!requestUrl.pathname.startsWith("/api/")) return next();
    const createdBy = await authenticate(request);
    if (!createdBy) return sendJson(response, 401, { error: "Sign in to continue." });
    const jobMatch = requestUrl.pathname.match(/^\/api\/replay-jobs\/([^/]+)$/);
    if (request.method === "GET" && jobMatch) {
      let id: string;
      try {
        id = decodeURIComponent(jobMatch[1]);
      } catch {
        return sendJson(response, 404, { error: "Replay job not found." });
      }
      const job = await processReplayJob.get(id, createdBy);
      if (!job) return sendJson(response, 404, { error: "Replay job not found." });
      return sendJson(response, 200, job);
    }
    const dataMatch = requestUrl.pathname.match(/^\/api\/replays\/([^/]+)\/data$/);
    if (request.method === "GET" && dataMatch) {
      let id: string;
      try {
        id = decodeURIComponent(dataMatch[1]);
      } catch {
        return sendJson(response, 404, { error: "Replay not found." });
      }
      const replay = await repository.getReplay(id, createdBy);
      if (!replay) return sendJson(response, 404, { error: "Replay not found." });
      return sendJson(response, 200, replay);
    }
    const bundleMatch = requestUrl.pathname.match(/^\/api\/replays\/([^/]+)$/);
    if (request.method === "DELETE" && bundleMatch) {
      let id: string;
      try {
        id = decodeURIComponent(bundleMatch[1]);
      } catch {
        return sendJson(response, 404, { error: "Replay not found." });
      }
      if (!await repository.deleteReplay(id, createdBy)) return sendJson(response, 404, { error: "Replay not found." });
      response.statusCode = 204;
      response.end();
      return;
    }
    if (request.method === "GET" && bundleMatch) {
      let id: string;
      try {
        id = decodeURIComponent(bundleMatch[1]);
      } catch {
        return sendJson(response, 404, { error: "Replay not found." });
      }
      const bundle = await repository.getBundle(id, createdBy);
      if (!bundle) return sendJson(response, 404, { error: "Replay not found." });
      return sendJson(response, 200, bundle);
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/replays") {
      return sendJson(response, 200, await repository.listReplays(createdBy));
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/player-mistakes") {
      const username = requestUrl.searchParams.get("username")?.trim() ?? "";
      if (!username) return sendJson(response, 400, { error: "Enter a player username." });
      const limit = replayLimit(requestUrl);
      if (!limit) return sendJson(response, 400, { error: "Replay count must be between 1 and 50." });
      try {
        const result = await repository.getPlayerMistakes(username, createdBy, limit);
        return sendJson(response, 200, result);
      } catch (error) {
        return sendJson(response, 500, { error: error instanceof Error ? error.message : "Could not load player mistakes." });
      }
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/player-mistakes/work-on") {
      const username = requestUrl.searchParams.get("username")?.trim() ?? "";
      if (!username) return sendJson(response, 400, { error: "Enter a player username." });
      const limit = replayLimit(requestUrl);
      if (!limit) return sendJson(response, 400, { error: "Replay count must be between 1 and 50." });
      try {
        return sendJson(response, 200, await analyzePlayerWeaknesses.execute(username, createdBy, limit));
      } catch (error) {
        if (error instanceof PlayerWeaknessesNotFoundError) return sendJson(response, 404, { error: error.message });
        if (error instanceof PlayerWeaknessesUnavailableError) return sendJson(response, 503, { error: error.message });
        console.error("Player weakness analysis failed.", error);
        return sendJson(response, 502, { error: "Could not analyze this player." });
      }
    }
    const explanationMatch = requestUrl.pathname.match(/^\/api\/player-mistakes\/([^/]+)\/explanation$/);
    if (request.method === "POST" && explanationMatch) {
      let id: string;
      try {
        id = decodeURIComponent(explanationMatch[1]);
      } catch {
        return sendJson(response, 404, { error: "Mistake not found." });
      }
      try {
        return sendJson(response, 200, await explainMistake.execute(id, createdBy));
      } catch (error) {
        if (error instanceof MistakeNotFoundError) return sendJson(response, 404, { error: error.message });
        if (error instanceof MistakeContextUnavailableError) return sendJson(response, 409, { error: error.message });
        if (error instanceof MistakeExplanationUnavailableError) return sendJson(response, 503, { error: error.message });
        return sendJson(response, 502, { error: "Could not generate the mistake explanation." });
      }
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/replay-uploads") {
      return sendJson(response, 404, { error: "Direct uploads are unavailable on the local server." });
    }
    if (request.method !== "POST" || requestUrl.pathname !== "/api/replays") return next();

    let filename: string;
    try {
      filename = decodeURIComponent(String(request.headers["x-replay-filename"] ?? ""));
    } catch {
      return sendJson(response, 400, { error: "Choose a valid .replay filename." });
    }
    const contentLength = Number(request.headers["content-length"] ?? 0);
    if (basename(filename) !== filename || filename.includes("\\") || !filename.toLowerCase().endsWith(".replay")) {
      return sendJson(response, 400, { error: "Choose a .replay file." });
    }
    if (!Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > MAX_UPLOAD_BYTES) {
      return sendJson(response, 413, { error: "Replay must be between 1 byte and 100 MB." });
    }

    let source: ReplaySource | undefined;
    try {
      source = await receiveUpload(request, filename, createdBy);
      const jobId = await processReplayJob.submit(source);
      source = undefined;
      const statusUrl = `/api/replay-jobs/${encodeURIComponent(jobId)}`;
      response.setHeader("Location", statusUrl);
      sendJson(response, 202, replayJobCreatedSchema.parse({ jobId, status: "queued", statusUrl }));
    } catch (error) {
      await source?.dispose().catch(() => undefined);
      sendJson(response, 500, { error: error instanceof Error ? error.message : "Replay processing failed." });
    }
  };
}

export function createReplayApiPlugin(
  processReplayJob: ProcessReplayJob,
  repository: ReplayRepository,
  explainMistake: ExplainMistake,
  analyzePlayerWeaknesses: AnalyzePlayerWeaknesses,
  authenticate: AuthenticateRequest,
): Plugin {
  const handler = createReplayHttpHandler(processReplayJob, repository, explainMistake, analyzePlayerWeaknesses, authenticate);
  return {
    name: "replay-api",
    configureServer(server) { server.middlewares.use(handler); },
    configurePreviewServer(server) { server.middlewares.use(handler); },
  };
}
