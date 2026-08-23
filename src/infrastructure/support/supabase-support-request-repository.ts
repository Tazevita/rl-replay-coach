import type { SupabaseClient } from "@supabase/supabase-js";
import type { SupportRequestRepository } from "../../application/ports";

type SupabaseClientLike = Pick<SupabaseClient, "from">;

export class SupabaseSupportRequestRepository implements SupportRequestRepository {
  constructor(private readonly client: SupabaseClientLike) {}

  async create(record: Parameters<SupportRequestRepository["create"]>[0]): Promise<void> {
    const response = await this.client.from("support_requests").insert({
      id: record.id,
      created_by: record.createdBy,
      email: record.email,
      subject: record.subject,
      message: record.message,
      created_at: record.createdAt,
    });
    if (response.error) throw new Error(`Supabase create support request failed: ${response.error.message}`);
  }
}
