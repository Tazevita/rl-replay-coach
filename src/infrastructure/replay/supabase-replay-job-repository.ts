import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReplayJobRepository } from "../../application/ports";
import { replayJobSchema, type ReplayJob, type ReplayJobStatus } from "../../shared/contracts/replay-job";
import type { ReplayAnalysisBundleV2 } from "../../shared/contracts/replay-analysis-v2";

type SupabaseClientLike = Pick<SupabaseClient, "from" | "rpc">;

export interface ReplayUploadJobRecord {
  id: string;
  createdBy: string;
  status: ReplayJobStatus;
  filename: string;
  contentHash: string;
  uploadBytes: number;
  sourceObjectKey: string;
  parsedObjectKey: string;
  analysisObjectKey: string;
  dispatchedAt?: string;
}

function assertSuccess(response: { error: { message: string } | null }, operation: string): void {
  if (response.error) throw new Error(`Supabase ${operation} failed: ${response.error.message}`);
}

export class SupabaseReplayJobRepository implements ReplayJobRepository {
  constructor(private readonly client: SupabaseClientLike) {}

  async create(record: { id: string; createdBy: string; createdAt: string }): Promise<void> {
    assertSuccess(await this.client.from("replay_jobs").insert({
      id: record.id,
      created_by: record.createdBy,
      status: "queued",
      created_at: record.createdAt,
      updated_at: record.createdAt,
    }), "create replay job");
  }

  async createUpload(record: Omit<ReplayUploadJobRecord, "status" | "dispatchedAt"> & { createdAt: string }): Promise<void> {
    assertSuccess(await this.client.from("replay_jobs").insert({
      id: record.id,
      created_by: record.createdBy,
      status: "queued",
      filename: record.filename,
      content_hash: record.contentHash,
      upload_bytes: record.uploadBytes,
      source_object_key: record.sourceObjectKey,
      parsed_object_key: record.parsedObjectKey,
      analysis_object_key: record.analysisObjectKey,
      created_at: record.createdAt,
      updated_at: record.createdAt,
    }), "create replay upload job");
  }

  async getUpload(id: string, createdBy: string): Promise<ReplayUploadJobRecord | undefined> {
    const response = await this.client.from("replay_jobs")
      .select("id,created_by,status,filename,content_hash,upload_bytes,source_object_key,parsed_object_key,analysis_object_key,dispatched_at")
      .eq("id", id)
      .eq("created_by", createdBy)
      .maybeSingle();
    assertSuccess(response, "get replay upload job");
    const row = response.data as {
      id: string;
      created_by: string;
      status: ReplayJobStatus;
      filename: string | null;
      content_hash: string | null;
      upload_bytes: number | null;
      source_object_key: string | null;
      parsed_object_key: string | null;
      analysis_object_key: string | null;
      dispatched_at: string | null;
    } | null;
    if (!row || !row.filename || !row.content_hash || !row.upload_bytes || !row.source_object_key || !row.parsed_object_key || !row.analysis_object_key) return undefined;
    return {
      id: row.id,
      createdBy: row.created_by,
      status: row.status,
      filename: row.filename,
      contentHash: row.content_hash,
      uploadBytes: row.upload_bytes,
      sourceObjectKey: row.source_object_key,
      parsedObjectKey: row.parsed_object_key,
      analysisObjectKey: row.analysis_object_key,
      dispatchedAt: row.dispatched_at ?? undefined,
    };
  }

  async claimDispatch(id: string, createdBy: string, now: string, staleBefore: string): Promise<boolean> {
    const response = await this.client.rpc("claim_replay_job_dispatch", {
      p_id: id,
      p_created_by: createdBy,
      p_now: now,
      p_stale_before: staleBefore,
    });
    assertSuccess(response, "claim replay job dispatch");
    return response.data === true;
  }

  async markDispatched(id: string, createdBy: string, updatedAt: string): Promise<void> {
    assertSuccess(await this.client.from("replay_jobs")
      .update({ status: "processing", dispatched_at: updatedAt, dispatch_lease_at: null, updated_at: updatedAt })
      .eq("id", id)
      .eq("created_by", createdBy), "mark replay job dispatched");
  }

  async releaseDispatch(id: string, createdBy: string): Promise<void> {
    assertSuccess(await this.client.from("replay_jobs")
      .update({ dispatch_lease_at: null })
      .eq("id", id)
      .eq("created_by", createdBy), "release replay job dispatch");
  }

  async claimFinalization(id: string, createdBy: string, now: string, staleBefore: string): Promise<boolean> {
    const response = await this.client.rpc("claim_replay_job_finalization", {
      p_id: id,
      p_created_by: createdBy,
      p_now: now,
      p_stale_before: staleBefore,
    });
    assertSuccess(response, "claim replay job finalization");
    return response.data === true;
  }

  async setStatus(id: string, createdBy: string, status: ReplayJobStatus, updatedAt: string): Promise<void> {
    assertSuccess(await this.client.from("replay_jobs")
      .update({ status, result: null, error: null, updated_at: updatedAt })
      .eq("id", id)
      .eq("created_by", createdBy), "update replay job status");
  }

  async complete(id: string, createdBy: string, result: ReplayAnalysisBundleV2, updatedAt: string): Promise<void> {
    assertSuccess(await this.client.from("replay_jobs")
      .update({ status: "completed", result, error: null, finalization_lease_at: null, updated_at: updatedAt })
      .eq("id", id)
      .eq("created_by", createdBy), "complete replay job");
  }

  async fail(id: string, createdBy: string, error: string, updatedAt: string): Promise<void> {
    assertSuccess(await this.client.from("replay_jobs")
      .update({ status: "failed", result: null, error, dispatch_lease_at: null, finalization_lease_at: null, updated_at: updatedAt })
      .eq("id", id)
      .eq("created_by", createdBy), "fail replay job");
  }

  async get(id: string, createdBy: string): Promise<ReplayJob | undefined> {
    const response = await this.client.from("replay_jobs")
      .select("id,status,result,error")
      .eq("id", id)
      .eq("created_by", createdBy)
      .maybeSingle();
    assertSuccess(response, "get replay job");
    const row = response.data as { id: string; status: ReplayJobStatus; result: unknown; error: string | null } | null;
    if (!row) return undefined;
    if (row.status === "completed") return replayJobSchema.parse({ jobId: row.id, status: row.status, result: row.result });
    if (row.status === "failed") return replayJobSchema.parse({ jobId: row.id, status: row.status, error: row.error ?? "Replay processing failed." });
    return replayJobSchema.parse({ jobId: row.id, status: row.status });
  }
}
