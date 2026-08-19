import { Readable } from "node:stream";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LambdaReplayParser } from "./lambda-replay-parser";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))));

const replay = {
  properties: {},
  objects: [],
  names: [],
  network_frames: {
    frames: [{ time: 0, new_actors: [], updated_actors: [], deleted_actors: [] }],
  },
};

const analysis = {
  schemaVersion: 1,
  teams: [],
  playerPredictions: { sampleIntervalSeconds: 1, players: [] },
};

describe("LambdaReplayParser", () => {
  it("uploads, queues, downloads, and cleans up a parsed replay", async () => {
    const root = await mkdtemp(join(tmpdir(), "lambda-parser-test-"));
    directories.push(root);
    const sourcePath = join(root, "source.replay");
    await writeFile(sourcePath, "replay bytes");
    const storageCommands: unknown[] = [];
    const queueCommands: unknown[] = [];
    const storageClient = {
      send: vi.fn(async command => {
        storageCommands.push(command);
        if (command instanceof GetObjectCommand) {
          const value = command.input.Key?.includes("/analysis/") ? analysis : replay;
          return { Body: Readable.from(JSON.stringify(value)) };
        }
        return {};
      }),
    };
    const parser = new LambdaReplayParser({
      queueUrl: "https://sqs.example/parser",
      secretId: "rrrocket/dev/r2",
      temporaryRoot: root,
      createJobId: () => "job-1",
      secretsClient: {
        send: vi.fn(async command => {
          expect(command).toBeInstanceOf(GetSecretValueCommand);
          return { SecretString: JSON.stringify({
            accountId: "account",
            bucket: "replays",
            accessKeyId: "key",
            secretAccessKey: "secret",
          }) };
        }),
      },
      createStorageClient: () => storageClient,
      queueClient: { send: vi.fn(async command => { queueCommands.push(command); return {}; }) },
    });

    const parsed = await parser.parse(sourcePath);

    expect(parsed.data).toEqual(replay);
    expect(parsed.objectKey).toBe("jobs/job-1/parsed/replay-v0.11.5.json");
    expect(JSON.parse(await readFile(parsed.analysisInputPath, "utf8"))).toEqual(analysis);
    expect(storageCommands[0]).toBeInstanceOf(PutObjectCommand);
    expect((storageCommands[0] as PutObjectCommand).input).toMatchObject({
      Bucket: "replays",
      Key: "jobs/job-1/source.replay",
      ContentLength: 12,
      IfNoneMatch: "*",
    });
    expect(queueCommands[0]).toBeInstanceOf(SendMessageCommand);
    expect((queueCommands[0] as SendMessageCommand).input).toEqual({
      QueueUrl: "https://sqs.example/parser",
      MessageBody: JSON.stringify({
        jobId: "job-1",
        sourceKey: "jobs/job-1/source.replay",
        outputKey: "jobs/job-1/parsed/replay-v0.11.5.json",
        analysisOutputKey: "jobs/job-1/analysis/replay-analysis-v1.json",
      }),
    });
    expect(storageCommands[1]).toBeInstanceOf(GetObjectCommand);
    expect((storageCommands[1] as GetObjectCommand).input.Key).toBe("jobs/job-1/parsed/replay-v0.11.5.json");
    expect((storageCommands[2] as GetObjectCommand).input.Key).toBe("jobs/job-1/analysis/replay-analysis-v1.json");

    const outputPath = parsed.analysisInputPath;
    await parsed.dispose();
    await expect(stat(outputPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes malformed Lambda output", async () => {
    const root = await mkdtemp(join(tmpdir(), "lambda-parser-test-"));
    directories.push(root);
    const sourcePath = join(root, "source.replay");
    await writeFile(sourcePath, "replay bytes");
    const parser = new LambdaReplayParser({
      queueUrl: "queue",
      secretId: "secret-id",
      temporaryRoot: root,
      createJobId: () => "job-2",
      secretsClient: { send: async () => ({ SecretString: JSON.stringify({
        accountId: "account", bucket: "replays", accessKeyId: "key", secretAccessKey: "secret",
      }) }) },
      createStorageClient: () => ({
        send: async command => command instanceof GetObjectCommand ? { Body: Readable.from("{}") } : {},
      }),
      queueClient: { send: async () => ({}) },
    });

    await expect(parser.parse(sourcePath)).rejects.toThrow();
    expect(await readdir(root)).toEqual(["source.replay"]);
  });
});
