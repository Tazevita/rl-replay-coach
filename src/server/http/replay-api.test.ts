import { createServer, request as httpRequest, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProcessReplayJob } from "../../application/process-replay-job";
import type { ExplainMistake } from "../../application/explain-mistake";
import type { AnalyzePlayerWeaknesses } from "../../application/analyze-player-weaknesses";
import type { ReplayRepository } from "../../application/ports";
import { replayData, validBundle } from "../../test/fixtures";
import { createReplayHttpHandler, MAX_UPLOAD_BYTES, type AuthenticateRequest } from "./replay-api";

const servers: Server[] = [];
afterEach(async () => Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve())))));

async function serve(
  processReplayJob: Pick<ProcessReplayJob, "submit" | "get">,
  repository: ReplayRepository,
  explainMistake: Pick<ExplainMistake, "execute"> = { execute: vi.fn() },
  analyzePlayerWeaknesses: Pick<AnalyzePlayerWeaknesses, "execute"> = { execute: vi.fn() },
  authenticate: AuthenticateRequest = async () => "user-a",
): Promise<string> {
  const handler = createReplayHttpHandler(processReplayJob, repository, explainMistake, analyzePlayerWeaknesses, authenticate);
  const server = createServer((request, response) => handler(request, response, () => {
    response.statusCode = 404;
    response.end();
  }));
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  return `http://127.0.0.1:${address.port}`;
}

function oversizedPost(url: URL): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, {
      method: "POST",
      headers: { "X-Replay-Filename": "match.replay", "Content-Length": MAX_UPLOAD_BYTES + 1 },
    }, response => {
      response.resume();
      response.on("end", () => resolve(response.statusCode ?? 0));
    });
    request.on("error", reject);
    request.end();
  });
}

function fakeRepository(): ReplayRepository {
  return {
    listReplays: vi.fn(async () => []),
    deleteReplay: vi.fn(async () => false),
    findBundleByHash: vi.fn(),
    publish: vi.fn(async record => record.bundle),
    getReplay: vi.fn(),
    getBundle: vi.fn(),
    getPlayerMistakes: vi.fn(async username => ({
      username, createdBy: "johndoe", playerIds: [], replayCount: 0, totalMistakes: 0, tacticalFocus: [], decisionHabits: [], mistakes: [],
    })),
    getMistake: vi.fn(),
    saveMistakeExplanation: vi.fn(),
  };
}

function fakeJobs(): Pick<ProcessReplayJob, "submit" | "get"> {
  return { submit: vi.fn(async () => "job-id"), get: vi.fn() };
}

describe("replay HTTP adapter", () => {
  it("rejects API requests without an authenticated user", async () => {
    const repository = fakeRepository();
    const base = await serve(fakeJobs(), repository, undefined, undefined, async () => undefined);
    const response = await fetch(`${base}/api/player-mistakes?username=Alpha`);
    expect(response.status).toBe(401);
    expect(repository.getPlayerMistakes).not.toHaveBeenCalled();
  });

  it("serves a stored replay ID and returns 404 for an unknown ID", async () => {
    const repository = fakeRepository();
    vi.mocked(repository.getReplay).mockImplementation(async (id, createdBy) => id === "stored" && createdBy === "user-a" ? replayData : undefined);
    const base = await serve(fakeJobs(), repository);
    expect((await fetch(`${base}/api/replays/stored/data`)).status).toBe(200);
    expect((await fetch(`${base}/api/replays/unknown/data`)).status).toBe(404);
    expect(repository.getReplay).toHaveBeenCalledWith("stored", "user-a");
  });

  it("serves the saved analysis bundle for deep links", async () => {
    const repository = fakeRepository();
    vi.mocked(repository.getBundle).mockImplementation(async (id, createdBy) => id === "stored" && createdBy === "user-a" ? validBundle() : undefined);
    const base = await serve(fakeJobs(), repository);
    const response = await fetch(`${base}/api/replays/stored`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ schemaVersion: 2 });
    expect((await fetch(`${base}/api/replays/unknown`)).status).toBe(404);
    expect(repository.getBundle).toHaveBeenCalledWith("stored", "user-a");
  });

  it("lists and deletes only the authenticated user's replays", async () => {
    const repository = fakeRepository();
    vi.mocked(repository.listReplays).mockResolvedValue([
      { id: "stored", filename: "ranked.replay", analyzedAt: "2026-08-19T12:00:00.000Z" },
    ]);
    vi.mocked(repository.deleteReplay).mockImplementation(async (id, owner) => id === "stored" && owner === "user-a");
    const base = await serve(fakeJobs(), repository);

    const history = await fetch(`${base}/api/replays`);
    expect(history.status).toBe(200);
    expect(await history.json()).toEqual([
      { id: "stored", filename: "ranked.replay", analyzedAt: "2026-08-19T12:00:00.000Z" },
    ]);
    expect(repository.listReplays).toHaveBeenCalledWith("user-a");

    expect((await fetch(`${base}/api/replays/stored`, { method: "DELETE" })).status).toBe(204);
    expect((await fetch(`${base}/api/replays/unknown`, { method: "DELETE" })).status).toBe(404);
    expect(repository.deleteReplay).toHaveBeenNthCalledWith(1, "stored", "user-a");
  });

  it("rejects invalid filenames and oversized uploads", async () => {
    const repository = fakeRepository();
    const base = await serve(fakeJobs(), repository);
    const invalid = await fetch(`${base}/api/replays`, {
      method: "POST",
      headers: { "X-Replay-Filename": encodeURIComponent("../match.replay") },
      body: "x",
    });
    expect(invalid.status).toBe(400);
    const windowsPath = await fetch(`${base}/api/replays`, {
      method: "POST",
      headers: { "X-Replay-Filename": encodeURIComponent("..\\match.replay") },
      body: "x",
    });
    expect(windowsPath.status).toBe(400);
    expect(await oversizedPost(new URL(`${base}/api/replays`))).toBe(413);
  });

  it("accepts an upload and returns a pollable job", async () => {
    const repository = fakeRepository();
    const jobs = fakeJobs();
    const base = await serve(jobs, repository);
    const response = await fetch(`${base}/api/replays`, {
      method: "POST",
      headers: { "X-Replay-Filename": "match.replay" },
      body: "replay bytes",
    });
    expect(response.status).toBe(202);
    expect(response.headers.get("location")).toBe("/api/replay-jobs/job-id");
    expect(await response.json()).toEqual({ jobId: "job-id", status: "queued", statusUrl: "/api/replay-jobs/job-id" });
    expect(jobs.submit).toHaveBeenCalledWith(expect.objectContaining({
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      createdBy: "user-a",
    }));
  });

  it("returns owned job status and hides unknown jobs", async () => {
    const jobs = fakeJobs();
    vi.mocked(jobs.get).mockImplementation(async id => id === "job-id"
      ? { jobId: "job-id", status: "completed", result: validBundle() }
      : undefined);
    const base = await serve(jobs, fakeRepository());
    const response = await fetch(`${base}/api/replay-jobs/job-id`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ jobId: "job-id", status: "completed", result: { schemaVersion: 2 } });
    expect(jobs.get).toHaveBeenCalledWith("job-id", "user-a");
    expect((await fetch(`${base}/api/replay-jobs/unknown`)).status).toBe(404);
  });

  it("looks up saved mistakes only for the authenticated uploader", async () => {
    const repository = fakeRepository();
    const authenticate: AuthenticateRequest = async request => request.headers.authorization?.slice("Bearer ".length);
    const base = await serve(fakeJobs(), repository, undefined, undefined, authenticate);
    const first = await fetch(`${base}/api/player-mistakes?username=${encodeURIComponent(" Alpha ")}&replays=5`, { headers: { Authorization: "Bearer user-a" } });
    const second = await fetch(`${base}/api/player-mistakes?username=${encodeURIComponent(" Alpha ")}&replays=50`, { headers: { Authorization: "Bearer user-b" } });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(repository.getPlayerMistakes).toHaveBeenNthCalledWith(1, "Alpha", "user-a", 5);
    expect(repository.getPlayerMistakes).toHaveBeenNthCalledWith(2, "Alpha", "user-b", 50);
  });

  it("rejects replay context counts outside 1 through 50", async () => {
    const repository = fakeRepository();
    const base = await serve(fakeJobs(), repository);
    expect((await fetch(`${base}/api/player-mistakes?username=Alpha&replays=0`)).status).toBe(400);
    expect((await fetch(`${base}/api/player-mistakes?username=Alpha&replays=51`)).status).toBe(400);
    expect((await fetch(`${base}/api/player-mistakes?username=Alpha&replays=5.5`)).status).toBe(400);
    expect(repository.getPlayerMistakes).not.toHaveBeenCalled();
  });

  it("generates a mistake explanation for the authenticated creator", async () => {
    const repository = fakeRepository();
    const explanation = {
      text: "Rotate back before challenging.", generatedAt: "2026-08-19T12:00:00.000Z", model: "gpt-5.6", promptVersion: "1",
    };
    const explainMistake = { execute: vi.fn(async () => ({ mistakeId: "replay:finding", explanation })) };
    const base = await serve(fakeJobs(), repository, explainMistake);
    const response = await fetch(`${base}/api/player-mistakes/${encodeURIComponent("replay:finding")}/explanation`, { method: "POST" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ mistakeId: "replay:finding", explanation });
    expect(explainMistake.execute).toHaveBeenCalledWith("replay:finding", "user-a");
  });

  it("generates player weaknesses for the authenticated creator", async () => {
    const repository = fakeRepository();
    const analysis = {
      username: "Alpha", generatedAt: "2026-08-19T12:00:00.000Z", model: "gpt-5.6-luna", promptVersion: "1",
      weaknesses: [{ weakness: "Recover first", pattern: "You engage before recovering.", workOn: "Get goal-side before challenging.", remember: "When you lose the play, rotate behind your teammate." }],
    };
    const analyze = { execute: vi.fn(async () => analysis) };
    const base = await serve(fakeJobs(), repository, { execute: vi.fn() }, analyze);
    const response = await fetch(`${base}/api/player-mistakes/work-on?username=${encodeURIComponent(" Alpha ")}&replays=10`, { method: "POST" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(analysis);
    expect(analyze.execute).toHaveBeenCalledWith("Alpha", "user-a", 10);
  });

  it("accepts concurrent uploads as separate jobs", async () => {
    let nextId = 0;
    const jobs = fakeJobs();
    vi.mocked(jobs.submit).mockImplementation(async () => `job-${++nextId}`);
    const repository = fakeRepository();
    const base = await serve(jobs, repository);
    const [first, second] = await Promise.all([fetch(`${base}/api/replays`, {
      method: "POST", headers: { "X-Replay-Filename": "first.replay" }, body: "one",
    }), fetch(`${base}/api/replays`, {
      method: "POST", headers: { "X-Replay-Filename": "second.replay" }, body: "two",
    })]);
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(jobs.submit).toHaveBeenCalledTimes(2);
  });
});
