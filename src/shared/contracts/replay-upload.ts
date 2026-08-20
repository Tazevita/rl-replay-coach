import { z } from "zod";

export const MAX_REPLAY_UPLOAD_BYTES = 100 * 1024 * 1024;

export const replayUploadRequestSchema = z.object({
  filename: z.string().min(1).max(255),
  size: z.number().int().min(1).max(MAX_REPLAY_UPLOAD_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export const replayUploadCreatedSchema = z.discriminatedUnion("status", [
  z.object({
    jobId: z.string().min(1),
    status: z.literal("uploading"),
    statusUrl: z.string().min(1),
    dispatchUrl: z.string().min(1),
    uploadUrl: z.string().url(),
    uploadHeaders: z.record(z.string(), z.string()),
  }).strict(),
  z.object({
    jobId: z.string().min(1),
    status: z.literal("completed"),
    statusUrl: z.string().min(1),
  }).strict(),
]);

export type ReplayUploadRequest = z.infer<typeof replayUploadRequestSchema>;
export type ReplayUploadCreated = z.infer<typeof replayUploadCreatedSchema>;
