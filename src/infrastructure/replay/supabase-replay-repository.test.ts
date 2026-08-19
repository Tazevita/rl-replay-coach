import { describe, expect, it, vi } from "vitest";
import { replayAnalysisBundleV2Schema } from "../../shared/contracts/replay-analysis-v2";
import { replayData, validBundle } from "../../test/fixtures";
import type { ReplayObjectReader } from "./r2-object-reader";
import { SupabaseReplayRepository } from "./supabase-replay-repository";

interface QueryCall {
  table: string;
  operation?: string;
  filters: Array<[string, string, unknown]>;
  value?: unknown;
}

function mockClient(responses: Record<string, Array<{ data: unknown; error: null }>>) {
  const calls: QueryCall[] = [];
  const from = vi.fn((table: string) => {
    const call: QueryCall = { table, filters: [] };
    calls.push(call);
    const query: any = {
      select(selection: string) { call.operation = "select"; call.value = selection; return query; },
      update(value: unknown) { call.operation = "update"; call.value = value; return query; },
      insert(value: unknown) { call.operation = "insert"; call.value = value; return query; },
      delete() { call.operation = "delete"; return query; },
      eq(column: string, value: unknown) { call.filters.push(["eq", column, value]); return query; },
      in(column: string, value: unknown) { call.filters.push(["in", column, value]); return query; },
      is(column: string, value: unknown) { call.filters.push(["is", column, value]); return query; },
      order(column: string, value: unknown) { call.filters.push(["order", column, value]); return query; },
      limit(value: unknown) { call.filters.push(["limit", "", value]); return query; },
      range() { return Promise.resolve((responses[table] ?? []).shift() ?? { data: [], error: null }); },
      maybeSingle() { return Promise.resolve((responses[table] ?? []).shift() ?? { data: null, error: null }); },
      then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
        return Promise.resolve((responses[table] ?? []).shift() ?? { data: [], error: null }).then(resolve, reject);
      },
    };
    return query;
  });
  return { from, rpc: vi.fn(), calls };
}

const noObjects: ReplayObjectReader = { read: vi.fn(async () => replayData) };

describe("SupabaseReplayRepository", () => {
  it("publishes through the atomic RPC and requires a private R2 key", async () => {
    const client = mockClient({});
    const bundle = replayAnalysisBundleV2Schema.parse(validBundle());
    bundle.analysis.teams[0].players = [{ id: "player-1", displayName: "Alpha" }];
    client.rpc.mockResolvedValue({ data: bundle, error: null });
    const repository = new SupabaseReplayRepository(client as never, noObjects);
    const record = {
      id: "replay-1", contentHash: "hash", createdBy: "owner", filename: "match.replay",
      replay: replayData, bundle,
    };

    await expect(repository.publish(record)).rejects.toThrow("requires the private R2 parsed replay object key");
    expect(client.rpc).not.toHaveBeenCalled();

    await expect(repository.publish({ ...record, replayObjectKey: "jobs/1/parsed/replay.json" })).resolves.toEqual(bundle);
    expect(client.rpc).toHaveBeenCalledWith("publish_replay", expect.objectContaining({
      p_id: "replay-1",
      p_created_by: "owner",
      p_replay_object_key: "jobs/1/parsed/replay.json",
      p_players: [{ id: "player-1", display_name: "Alpha", team: "blue" }],
      p_bundle: bundle,
    }));
    expect(client.from).not.toHaveBeenCalled();
  });

  it("loads and validates replay data from the stored private R2 object key", async () => {
    const client = mockClient({ replays: [{ data: { replay_object_key: "private/replay.json" }, error: null }] });
    const objects = { read: vi.fn(async () => replayData) };
    const repository = new SupabaseReplayRepository(client as never, objects);

    await expect(repository.getReplay("replay-1", "johndoe")).resolves.toEqual(replayData);
    expect(objects.read).toHaveBeenCalledWith("private/replay.json");
  });

  it("lists and deletes creator-scoped replay history", async () => {
    const client = mockClient({ replays: [
      { data: [{ id: "new", filename: "new.replay", analyzed_at: "2026-08-19T00:00:00+00:00" }], error: null },
      { data: { id: "new" }, error: null },
    ] });
    const repository = new SupabaseReplayRepository(client as never, noObjects);

    await expect(repository.listReplays("owner")).resolves.toEqual([
      { id: "new", filename: "new.replay", analyzedAt: "2026-08-19T00:00:00.000Z" },
    ]);
    await expect(repository.deleteReplay("new", "owner")).resolves.toBe(true);
    expect(client.calls[0].filters).toContainEqual(["eq", "created_by", "owner"]);
    expect(client.calls[1]).toMatchObject({ operation: "select", filters: [
      ["eq", "id", "new"], ["eq", "created_by", "owner"],
    ] });
  });

  it("aggregates creator-scoped history and preserves newest-first mistake ordering", async () => {
    const client = mockClient({
      replays: [{ data: [
        { id: "old", filename: "old.replay", analyzed_at: "2026-08-18T00:00:00+00:00", replay_object_key: "old.json" },
        { id: "new", filename: "new.replay", analyzed_at: "2026-08-19T00:00:00+00:00", replay_object_key: "new.json" },
      ], error: null }],
      replay_players: [{ data: [
        { replay_id: "old", player_id: "player-1", display_name: "Alpha" },
        { replay_id: "new", player_id: "player-1", display_name: "ALPHA" },
      ], error: null }],
      mistakes: [{ data: [mistake("old", 20), {
        ...mistake("new", 10),
        explanation_text: "Hold the rotation.",
        explanation_generated_at: "2026-08-19T01:02:03+00:00",
        explanation_model: "test-model",
        explanation_prompt_version: "1",
      }], error: null }],
    });
    const repository = new SupabaseReplayRepository(client as never, noObjects);

    const history = await repository.getPlayerMistakes("alpha", "owner", 50);

    expect(history).toMatchObject({ playerIds: ["player-1"], replayCount: 2, totalMistakes: 2 });
    expect(history.mistakes.map(item => item.replayId)).toEqual(["new", "old"]);
    expect(history.mistakes.map(item => item.analyzedAt)).toEqual([
      "2026-08-19T00:00:00.000Z",
      "2026-08-18T00:00:00.000Z",
    ]);
    expect(history.mistakes[0].explanation?.generatedAt).toBe("2026-08-19T01:02:03.000Z");
    expect(history.tacticalFocus).toEqual([expect.objectContaining({
      expectedFamily: "RECOVER", actualFamily: "ENGAGE", count: 2, averageScore: 1.5,
    })]);
    expect(client.calls[0].filters).toContainEqual(["eq", "created_by", "owner"]);
    expect(client.calls[0].filters).toContainEqual(["limit", "", 50]);
  });
});

function mistake(replayId: string, occurredAtSeconds: number) {
  return {
    id: `${replayId}:finding-1`, replay_id: replayId, finding_id: "finding-1",
    player_id: "player-1", display_name: "Alpha", event_id: "event-1",
    occurred_at_seconds: occurredAtSeconds, anchor_seconds: occurredAtSeconds,
    expected_family: "RECOVER", actual_family: "ENGAGE",
    expected_intent: "ROTATE", actual_intent: "CHALLENGE", score: 1.5,
    sample_count: 3, window: "1-2s", start_time_seconds: occurredAtSeconds,
    text: "Rotate before challenging.", context: null, explanation_text: null,
    explanation_generated_at: null, explanation_model: null, explanation_prompt_version: null,
  };
}
