import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { fromIni } from "@aws-sdk/credential-providers";

interface AwsClient {
  send(command: unknown): Promise<any>;
}

export interface ReplayObjectReader {
  read(objectKey: string): Promise<unknown>;
}

export interface R2ObjectReaderOptions {
  secretId: string;
  region?: string;
  profile?: string;
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

export class R2ObjectReader implements ReplayObjectReader {
  private readonly secrets: AwsClient;
  private storagePromise?: Promise<{ bucket: string; client: AwsClient }>;

  constructor(private readonly options: R2ObjectReaderOptions) {
    const credentials = options.profile ? fromIni({ profile: options.profile }) : undefined;
    this.secrets = options.secretsClient ?? new SecretsManagerClient({ region: options.region, credentials });
  }

  async read(objectKey: string): Promise<unknown> {
    const storage = await this.storage();
    const response = await storage.client.send(new GetObjectCommand({ Bucket: storage.bucket, Key: objectKey }));
    if (!response.Body) throw new Error(`R2 object ${objectKey} has an empty body.`);
    const body = await response.Body.transformToString();
    try {
      return JSON.parse(body);
    } catch (error) {
      throw new Error(`R2 object ${objectKey} is not valid JSON.`, { cause: error });
    }
  }

  private async storage(): Promise<{ bucket: string; client: AwsClient }> {
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
}
