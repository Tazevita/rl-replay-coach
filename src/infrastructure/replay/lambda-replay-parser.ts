import { createReadStream, createWriteStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { fromIni } from "@aws-sdk/credential-providers";
import type { ParsedReplay, ReplayParser } from "../../application/ports";
import { replayParserJobSchema } from "../../shared/contracts/replay-parser-job";
import { rrrocketReplaySchema } from "../../shared/contracts/rrrocket";

interface AwsClient {
  send(command: unknown): Promise<any>;
}

interface Storage {
  bucket: string;
  client: AwsClient;
}

export interface LambdaReplayParserOptions {
  queueUrl: string;
  secretId: string;
  region?: string;
  profile?: string;
  timeoutMs?: number;
  analysisTimeoutMs?: number;
  pollIntervalMs?: number;
  temporaryRoot?: string;
  createJobId?: () => string;
  sleep?: (milliseconds: number) => Promise<void>;
  queueClient?: AwsClient;
  secretsClient?: AwsClient;
  createStorageClient?: (config: {
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
  }) => AwsClient;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

function isMissingObject(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return candidate.$metadata?.httpStatusCode === 404 || candidate.name === "NotFound" || candidate.name === "NoSuchKey";
}

export class LambdaReplayParser implements ReplayParser {
  private readonly queue: AwsClient;
  private readonly secrets: AwsClient;
  private storagePromise?: Promise<Storage>;

  constructor(private readonly options: LambdaReplayParserOptions) {
    const credentials = options.profile ? fromIni({ profile: options.profile }) : undefined;
    this.queue = options.queueClient ?? new SQSClient({ region: options.region, credentials });
    this.secrets = options.secretsClient ?? new SecretsManagerClient({ region: options.region, credentials });
  }

  async parse(sourcePath: string): Promise<ParsedReplay> {
    const jobId = (this.options.createJobId ?? randomUUID)();
    const job = replayParserJobSchema.parse({
      jobId,
      sourceKey: `jobs/${jobId}/source.replay`,
      outputKey: `jobs/${jobId}/parsed/replay-v0.11.5.json`,
      analysisOutputKey: `jobs/${jobId}/analysis/replay-analysis-v1.json`,
    });
    const storage = await this.storage();
    const source = await stat(sourcePath);

    await storage.client.send(new PutObjectCommand({
      Bucket: storage.bucket,
      Key: job.sourceKey,
      Body: createReadStream(sourcePath),
      ContentLength: source.size,
      ContentType: "application/octet-stream",
      IfNoneMatch: "*",
    }));
    await this.queue.send(new SendMessageCommand({
      QueueUrl: this.options.queueUrl,
      MessageBody: JSON.stringify(job),
    }));

    const directory = await mkdtemp(join(this.options.temporaryRoot ?? tmpdir(), "lambda-replay-parser-"));
    const parsedOutputPath = join(directory, "replay.json");
    const analysisOutputPath = join(directory, "analysis.json");
    try {
      await this.downloadWhenReady(storage, job.outputKey, parsedOutputPath, this.options.timeoutMs ?? 5 * 60_000, "parsing");
      const data = rrrocketReplaySchema.parse(JSON.parse(await readFile(parsedOutputPath, "utf8")));
      await this.downloadWhenReady(
        storage,
        job.analysisOutputKey,
        analysisOutputPath,
        this.options.analysisTimeoutMs ?? 15 * 60_000,
        "analysis",
      );
      return {
        data,
        analysisInputPath: analysisOutputPath,
        objectKey: job.outputKey,
        dispose: () => rm(directory, { recursive: true, force: true }),
      };
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  private async storage(): Promise<Storage> {
    this.storagePromise ??= (async () => {
      const response = await this.secrets.send(new GetSecretValueCommand({ SecretId: this.options.secretId }));
      const config = JSON.parse(requiredString(response.SecretString, "R2 secret value"));
      const accountId = requiredString(config.accountId, "R2 accountId");
      const accessKeyId = requiredString(config.accessKeyId, "R2 accessKeyId");
      const secretAccessKey = requiredString(config.secretAccessKey, "R2 secretAccessKey");
      const client = this.options.createStorageClient?.({
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        accessKeyId,
        secretAccessKey,
      }) ?? new S3Client({
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        region: "auto",
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
        credentials: { accessKeyId, secretAccessKey },
      });
      return { bucket: requiredString(config.bucket, "R2 bucket"), client };
    })();
    return this.storagePromise;
  }

  private async downloadWhenReady(
    storage: Storage,
    outputKey: string,
    outputPath: string,
    timeoutMs: number,
    stage: string,
  ): Promise<void> {
    const pollIntervalMs = this.options.pollIntervalMs ?? 1_000;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const response = await storage.client.send(new GetObjectCommand({ Bucket: storage.bucket, Key: outputKey }));
        if (!response.Body) throw new Error("R2 returned an empty parsed replay body.");
        await pipeline(response.Body, createWriteStream(outputPath, { flags: "wx" }));
        return;
      } catch (error) {
        if (!isMissingObject(error)) throw error;
      }
      await (this.options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))))(pollIntervalMs);
    }
    throw new Error(`Lambda replay ${stage} timed out after ${timeoutMs}ms.`);
  }
}
