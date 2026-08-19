import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReplayJobRepository } from "../../application/ports";
import { replayJobSchema, type ReplayJob, type ReplayJobStatus } from "../../shared/contracts/replay-job";
import type { ReplayAnalysisBundleV2 } from "../../shared/contracts/replay-analysis-v2";

type SupabaseClientLike = Pick<SupabaseClient, "from">;

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

  async setStatus(id: string, createdBy: string, status: ReplayJobStatus, updatedAt: string): Promise<void> {
    assertSuccess(await this.client.from("replay_jobs")
      .update({ status, result: null, error: null, updated_at: updatedAt })
      .eq("id", id)
      .eq("created_by", createdBy), "update replay job status");
  }

  async complete(id: string, createdBy: string, result: ReplayAnalysisBundleV2, updatedAt: string): Promise<void> {
    assertSuccess(await this.client.from("replay_jobs")
      .update({ status: "completed", result, error: null, updated_at: updatedAt })
      .eq("id", id)
      .eq("created_by", createdBy), "complete replay job");
  }

  async fail(id: string, createdBy: string, error: string, updatedAt: string): Promise<void> {
    assertSuccess(await this.client.from("replay_jobs")
      .update({ status: "failed", result: null, error, updated_at: updatedAt })
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
