import { DeleteObjectsCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSignedUrl } = vi.hoisted(() => ({
  getSignedUrl: vi.fn(async (_client: unknown, _command: unknown, _options: unknown) => "https://uploads.example/source.replay"),
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl }));

import { R2ObjectReader } from "./r2-object-reader";

describe("R2ObjectReader", () => {
  beforeEach(() => getSignedUrl.mockClear());

  it("creates a browser-compatible signed upload", async () => {
    const storageClient = { send: vi.fn() };
    const objects = new R2ObjectReader({
      secretId: "rrrocket/dev/r2",
      secretsClient: {
        send: vi.fn(async () => ({ SecretString: JSON.stringify({
          accountId: "account",
          bucket: "replays",
          accessKeyId: "key",
          secretAccessKey: "secret",
        }) })),
      },
      createStorageClient: () => storageClient,
    });

    const signed = await objects.createUploadUrl("jobs/job-1/source.replay", "replay-sha256");

    expect(signed).toEqual({
      url: "https://uploads.example/source.replay",
      headers: {
        "content-type": "application/octet-stream",
        "x-amz-meta-sha256": "replay-sha256",
      },
    });
    expect(getSignedUrl).toHaveBeenCalledWith(storageClient, expect.any(PutObjectCommand), {
      expiresIn: 15 * 60,
      unhoistableHeaders: new Set(["x-amz-meta-sha256"]),
    });
    expect((getSignedUrl.mock.calls[0][1] as PutObjectCommand).input).toEqual({
      Bucket: "replays",
      Key: "jobs/job-1/source.replay",
      ContentType: "application/octet-stream",
      Metadata: { sha256: "replay-sha256" },
    });
  });

  it("deletes all requested objects and reports per-object failures", async () => {
    const storageClient = { send: vi.fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Errors: [{ Key: "jobs/job-1/source.replay", Code: "AccessDenied" }] }) };
    const objects = new R2ObjectReader({
      secretId: "rrrocket/dev/r2",
      secretsClient: {
        send: vi.fn(async () => ({ SecretString: JSON.stringify({
          accountId: "account",
          bucket: "replays",
          accessKeyId: "key",
          secretAccessKey: "secret",
        }) })),
      },
      createStorageClient: () => storageClient,
    });

    const keys = ["jobs/job-1/source.replay", "jobs/job-1/parsed/replay.json"];
    await expect(objects.delete(keys)).resolves.toBeUndefined();
    expect(storageClient.send).toHaveBeenNthCalledWith(1, expect.any(DeleteObjectsCommand));
    expect((storageClient.send.mock.calls[0][0] as DeleteObjectsCommand).input).toEqual({
      Bucket: "replays",
      Delete: { Objects: keys.map(Key => ({ Key })), Quiet: true },
    });

    await expect(objects.delete(keys)).rejects.toThrow("source.replay (AccessDenied)");
  });
});
