import { describe, expect, it, vi } from "vitest";
import { validBundle } from "../../test/fixtures";
import { SupabaseReplayJobRepository } from "./supabase-replay-job-repository";

function mockClient(rows: unknown[]) {
  const calls: Array<{ operation?: string; value?: unknown; filters: unknown[] }> = [];
  return {
    calls,
    from: vi.fn(() => {
      const call = { filters: [] as unknown[], operation: undefined as string | undefined, value: undefined as unknown };
      calls.push(call);
      const query: any = {
        insert(value: unknown) { call.operation = "insert"; call.value = value; return query; },
        update(value: unknown) { call.operation = "update"; call.value = value; return query; },
        select(value: unknown) { call.operation = "select"; call.value = value; return query; },
        eq(column: string, value: unknown) { call.filters.push([column, value]); return query; },
        maybeSingle() { return Promise.resolve({ data: rows.shift() ?? null, error: null }); },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        },
      };
      return query;
    }),
  };
}

describe("SupabaseReplayJobRepository", () => {
  it("writes job transitions and validates completed results", async () => {
    const bundle = validBundle();
    const client = mockClient([{ id: "job-1", status: "completed", result: bundle, error: null }]);
    const repository = new SupabaseReplayJobRepository(client as never);

    await repository.create({ id: "job-1", createdBy: "owner", createdAt: "2026-08-19T00:00:00.000Z" });
    await repository.complete("job-1", "owner", bundle, "2026-08-19T00:01:00.000Z");
    await expect(repository.get("job-1", "owner")).resolves.toMatchObject({
      jobId: "job-1", status: "completed", result: { schemaVersion: 2 },
    });

    expect(client.calls[0]).toMatchObject({ operation: "insert", value: { status: "queued", created_by: "owner" } });
    expect(client.calls[1]).toMatchObject({ operation: "update", value: { status: "completed", result: bundle, error: null } });
    expect(client.calls[2].filters).toEqual([["id", "job-1"], ["created_by", "owner"]]);
  });

  it("returns no job when the creator-scoped query has no row", async () => {
    const repository = new SupabaseReplayJobRepository(mockClient([]) as never);
    await expect(repository.get("job-1", "other-owner")).resolves.toBeUndefined();
  });
});
