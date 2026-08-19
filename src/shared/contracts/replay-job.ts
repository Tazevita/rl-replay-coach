import { z } from "zod";
import { replayAnalysisBundleV2Schema } from "./replay-analysis-v2";

export const replayJobStatusSchema = z.enum(["queued", "processing", "completed", "failed"]);
export type ReplayJobStatus = z.infer<typeof replayJobStatusSchema>;

export const replayJobCreatedSchema = z.object({
  jobId: z.string().min(1),
  status: z.literal("queued"),
  statusUrl: z.string().min(1),
}).strict();
export type ReplayJobCreated = z.infer<typeof replayJobCreatedSchema>;

export const replayJobSchema = z.discriminatedUnion("status", [
  z.object({ jobId: z.string().min(1), status: z.literal("queued") }).strict(),
  z.object({ jobId: z.string().min(1), status: z.literal("processing") }).strict(),
  z.object({
    jobId: z.string().min(1),
    status: z.literal("completed"),
    result: replayAnalysisBundleV2Schema,
  }).strict(),
  z.object({
    jobId: z.string().min(1),
    status: z.literal("failed"),
    error: z.string().min(1),
  }).strict(),
]);
export type ReplayJob = z.infer<typeof replayJobSchema>;
