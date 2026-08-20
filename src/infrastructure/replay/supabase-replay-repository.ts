import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReplayRepository } from "../../application/ports";
import { createMistakeContextSampler } from "../../replay/mistake-context";
import {
  mistakeExplanationSchema,
  mistakeReplayContextSchema,
  playerMistakeSchema,
  playerMistakesResponseSchema,
  type MistakeExplanation,
  type PlayerMistake,
  type PlayerMistakesResponse,
} from "../../shared/contracts/player-mistakes";
import { replayAnalysisBundleV2Schema, type ReplayAnalysisBundleV2 } from "../../shared/contracts/replay-analysis-v2";
import { rrrocketReplaySchema, type RrrocketReplay } from "../../shared/contracts/rrrocket";
import type { ReplayObjectReader } from "./r2-object-reader";
import { replayHistorySchema, type ReplayHistoryItem } from "../../shared/contracts/replay-history";

type SupabaseClientLike = Pick<SupabaseClient, "from" | "rpc">;

interface ReplayRow {
  id: string;
  filename: string;
  analyzed_at: string;
  replay_object_key: string;
  bundle?: unknown;
}

interface MistakeRow {
  id: string;
  replay_id: string;
  finding_id: string;
  player_id: string;
  display_name: string;
  event_id: string;
  occurred_at_seconds: number;
  anchor_seconds: number;
  expected_family: string;
  actual_family: string;
  expected_intent: string;
  actual_intent: string;
  score: number;
  sample_count: number;
  window: string;
  start_time_seconds: number;
  text: string;
  context: unknown | null;
  explanation_text: string | null;
  explanation_generated_at: string | null;
  explanation_model: string | null;
  explanation_prompt_version: string | null;
}

function unwrap<T>(response: { data: T; error: { message: string } | null }, operation: string): T {
  if (response.error) throw new Error(`Supabase ${operation} failed: ${response.error.message}`);
  return response.data;
}

function isoTimestamp(value: string): string {
  return new Date(value).toISOString();
}

async function fetchAll<T>(createQuery: () => any, operation: string): Promise<T[]> {
  const pageSize = 1_000;
  const rows: T[] = [];
  while (true) {
    const page = unwrap(await createQuery().range(rows.length, rows.length + pageSize - 1), operation) as T[];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

const mistakeSelection = [
  "id", "replay_id", "finding_id", "player_id", "display_name", "event_id",
  "occurred_at_seconds", "anchor_seconds", "expected_family", "actual_family",
  "expected_intent", "actual_intent", "score", "sample_count", "window",
  "start_time_seconds", "text", "context", "explanation_text",
  "explanation_generated_at", "explanation_model", "explanation_prompt_version",
].join(",");

export class SupabaseReplayRepository implements ReplayRepository {
  constructor(
    private readonly client: SupabaseClientLike,
    private readonly objects: ReplayObjectReader,
  ) {}

  async findBundleByHash(createdBy: string, contentHash: string): Promise<ReplayAnalysisBundleV2 | undefined> {
    const row = unwrap(await this.client.from("replays")
      .select("bundle")
      .eq("created_by", createdBy)
      .eq("content_hash", contentHash)
      .maybeSingle(), "find replay by hash") as { bundle: unknown } | null;
    return row ? replayAnalysisBundleV2Schema.parse(row.bundle) : undefined;
  }

  async listReplays(createdBy: string): Promise<ReplayHistoryItem[]> {
    const rows = await fetchAll<Pick<ReplayRow, "id" | "filename" | "analyzed_at">>(() => this.client.from("replays")
      .select("id,filename,analyzed_at")
      .eq("created_by", createdBy)
      .order("analyzed_at", { ascending: false }), "list replays");
    return replayHistorySchema.parse(rows.map(row => ({
      id: row.id,
      filename: row.filename,
      analyzedAt: isoTimestamp(row.analyzed_at),
    })));
  }

  async deleteReplay(id: string, createdBy: string): Promise<boolean> {
    const deleted = unwrap(await this.client.from("replays")
      .delete()
      .eq("id", id)
      .eq("created_by", createdBy)
      .select("id")
      .maybeSingle(), "delete replay") as { id: string } | null;
    return Boolean(deleted);
  }

  async publish(record: {
    id: string;
    contentHash: string;
    createdBy: string;
    filename: string;
    replay: RrrocketReplay;
    replayObjectKey?: string;
    bundle: ReplayAnalysisBundleV2;
  }): Promise<ReplayAnalysisBundleV2> {
    if (!record.replayObjectKey) {
      throw new Error("Supabase replay publication requires the private R2 parsed replay object key.");
    }
    const sampleContext = createMistakeContextSampler(record.replay);
    const players: Array<{ id: string; display_name: string; team: string }> = [];
    const mistakes: Array<Record<string, unknown>> = [];
    for (const team of record.bundle.analysis.teams) {
      for (const player of team.players) {
        if (player.id) players.push({ id: player.id, display_name: player.displayName, team: team.team.id });
      }
      for (const event of team.events) {
        for (const finding of event.findings) {
          const mistake = finding.extensions?.mistake;
          if (finding.kind !== "disagreement" || !mistake?.sustained || !finding.subject?.playerId) continue;
          mistakes.push({
            id: `${record.id}:${finding.id}`,
            finding_id: finding.id,
            player_id: finding.subject.playerId,
            display_name: finding.subject.displayName,
            event_id: event.id,
            occurred_at_seconds: event.occurredAtSeconds,
            anchor_seconds: finding.navigation?.anchorSeconds ?? mistake.startTimeSeconds,
            expected_family: mistake.expectedFamily,
            actual_family: mistake.actualFamily,
            expected_intent: mistake.expectedIntent,
            actual_intent: mistake.actualIntent,
            score: mistake.score,
            sample_count: mistake.sampleCount,
            window: mistake.window,
            start_time_seconds: mistake.startTimeSeconds,
            end_time_seconds: mistake.endTimeSeconds,
            expected_confidence: mistake.confidence.expected,
            actual_confidence: mistake.confidence.actual,
            text: finding.text,
            context: sampleContext(mistake.startTimeSeconds),
          });
        }
      }
    }
    const bundle = unwrap(await this.client.rpc("publish_replay", {
      p_id: record.id,
      p_content_hash: record.contentHash,
      p_created_by: record.createdBy,
      p_filename: record.filename,
      p_analyzed_at: record.bundle.analysis.generatedAt,
      p_replay_object_key: record.replayObjectKey,
      p_bundle: record.bundle,
      p_players: players,
      p_mistakes: mistakes,
    }), "publish replay");
    return replayAnalysisBundleV2Schema.parse(bundle);
  }

  async getReplay(id: string, createdBy: string): Promise<RrrocketReplay | undefined> {
    const objectKey = await this.getReplayObjectKey(id, createdBy);
    return objectKey ? rrrocketReplaySchema.parse(await this.objects.read(objectKey)) : undefined;
  }

  async getReplayObjectKey(id: string, createdBy: string): Promise<string | undefined> {
    const row = unwrap(await this.client.from("replays")
      .select("replay_object_key")
      .eq("id", id)
      .eq("created_by", createdBy)
      .maybeSingle(), "get replay object key") as { replay_object_key: string } | null;
    return row?.replay_object_key;
  }

  async getBundle(id: string, createdBy: string): Promise<ReplayAnalysisBundleV2 | undefined> {
    const row = unwrap(await this.client.from("replays")
      .select("bundle")
      .eq("id", id)
      .eq("created_by", createdBy)
      .maybeSingle(), "get replay bundle") as { bundle: unknown } | null;
    return row ? replayAnalysisBundleV2Schema.parse(row.bundle) : undefined;
  }

  async getPlayerMistakes(username: string, createdBy: string, replayLimit: number): Promise<PlayerMistakesResponse> {
    const replayRows = unwrap(await this.client.from("replays")
      .select("id,filename,analyzed_at,replay_object_key")
      .eq("created_by", createdBy)
      .order("analyzed_at", { ascending: false })
      .limit(replayLimit), "get creator replays") as ReplayRow[];
    const empty = () => playerMistakesResponseSchema.parse({
      username, createdBy, playerIds: [], replayCount: 0, totalMistakes: 0,
      tacticalFocus: [], decisionHabits: [], mistakes: [],
    });
    if (!replayRows.length) return empty();

    const replayIds = replayRows.map(row => row.id);
    const participants = await fetchAll<{
      replay_id: string;
      player_id: string;
      display_name: string;
    }>(() => this.client.from("replay_players")
      .select("replay_id,player_id,display_name")
      .in("replay_id", replayIds), "get replay players");
    const normalizedUsername = username.toLocaleLowerCase();
    const playerIds = [...new Set(participants
      .filter(player => player.display_name.toLocaleLowerCase() === normalizedUsername)
      .map(player => player.player_id))];
    if (!playerIds.length) return empty();

    const rows = await fetchAll<MistakeRow>(() => this.client.from("mistakes")
      .select(mistakeSelection)
      .in("replay_id", replayIds)
      .in("player_id", playerIds), "get player mistakes");
    const replayById = new Map(replayRows.map(row => [row.id, row]));
    rows.sort((left, right) => {
      const analyzed = Date.parse(replayById.get(right.replay_id)!.analyzed_at)
        - Date.parse(replayById.get(left.replay_id)!.analyzed_at);
      return analyzed || right.occurred_at_seconds - left.occurred_at_seconds;
    });

    const tacticalFocus = new Map<string, { expectedFamily: string; actualFamily: string; count: number; score: number }>();
    const decisionHabits = new Map<string, { expectedIntent: string; actualIntent: string; count: number; score: number }>();
    for (const row of rows) {
      if (row.expected_family !== row.actual_family) {
        const key = `${row.expected_family}\0${row.actual_family}`;
        const value = tacticalFocus.get(key) ?? { expectedFamily: row.expected_family, actualFamily: row.actual_family, count: 0, score: 0 };
        value.count += 1;
        value.score += row.score;
        tacticalFocus.set(key, value);
      }
      const key = `${row.expected_intent}\0${row.actual_intent}`;
      const value = decisionHabits.get(key) ?? { expectedIntent: row.expected_intent, actualIntent: row.actual_intent, count: 0, score: 0 };
      value.count += 1;
      value.score += row.score;
      decisionHabits.set(key, value);
    }

    return playerMistakesResponseSchema.parse({
      username,
      createdBy,
      playerIds,
      replayCount: new Set(rows.map(row => row.replay_id)).size,
      totalMistakes: rows.length,
      tacticalFocus: [...tacticalFocus.values()]
        .sort((left, right) => right.count - left.count || right.score - left.score)
        .map(({ score, ...value }) => ({ ...value, averageScore: score / value.count })),
      decisionHabits: [...decisionHabits.values()]
        .sort((left, right) => right.count - left.count || right.score - left.score)
        .map(({ score, ...value }) => ({ ...value, averageScore: score / value.count })),
      mistakes: rows.map(row => this.toMistake(row, replayById.get(row.replay_id)!)),
    });
  }

  async getMistake(id: string, createdBy: string): Promise<PlayerMistake | undefined> {
    const row = unwrap(await this.client.from("mistakes")
      .select(mistakeSelection)
      .eq("id", id)
      .maybeSingle(), "get mistake") as MistakeRow | null;
    if (!row) return undefined;
    const replay = unwrap(await this.client.from("replays")
      .select("id,filename,analyzed_at,replay_object_key")
      .eq("id", row.replay_id)
      .eq("created_by", createdBy)
      .maybeSingle(), "authorize mistake") as ReplayRow | null;
    if (!replay) return undefined;

    const savedContext = row.context ? mistakeReplayContextSchema.parse(row.context) : null;
    if (!savedContext || Math.abs(savedContext.endSeconds - row.start_time_seconds) > 0.001) {
      const replayData = rrrocketReplaySchema.parse(await this.objects.read(replay.replay_object_key));
      row.context = createMistakeContextSampler(replayData)(row.start_time_seconds);
      unwrap(await this.client.from("mistakes").update({ context: row.context }).eq("id", id), "repair mistake context");
    }
    return this.toMistake(row, replay);
  }

  async saveMistakeExplanation(
    id: string,
    createdBy: string,
    explanation: MistakeExplanation,
  ): Promise<MistakeExplanation | undefined> {
    if (!await this.getMistake(id, createdBy)) return undefined;
    const value = mistakeExplanationSchema.parse(explanation);
    unwrap(await this.client.from("mistakes").update({
      explanation_text: value.text,
      explanation_generated_at: value.generatedAt,
      explanation_model: value.model,
      explanation_prompt_version: value.promptVersion,
    }).eq("id", id).is("explanation_text", null), "save mistake explanation");
    return (await this.getMistake(id, createdBy))?.explanation ?? undefined;
  }

  private toMistake(row: MistakeRow, replay: ReplayRow): PlayerMistake {
    const explanation = row.explanation_text
      && row.explanation_generated_at
      && row.explanation_model
      && row.explanation_prompt_version
      ? {
          text: row.explanation_text,
          generatedAt: isoTimestamp(row.explanation_generated_at),
          model: row.explanation_model,
          promptVersion: row.explanation_prompt_version,
        }
      : null;
    return playerMistakeSchema.parse({
      id: row.id,
      replayId: row.replay_id,
      replayFilename: replay.filename,
      playerId: row.player_id,
      displayName: row.display_name,
      eventId: row.event_id,
      occurredAtSeconds: row.occurred_at_seconds,
      anchorSeconds: row.anchor_seconds,
      expectedFamily: row.expected_family,
      actualFamily: row.actual_family,
      expectedIntent: row.expected_intent,
      actualIntent: row.actual_intent,
      score: row.score,
      sampleCount: row.sample_count,
      window: row.window,
      text: row.text,
      analyzedAt: isoTimestamp(replay.analyzed_at),
      replayContext: row.context ? mistakeReplayContextSchema.parse(row.context) : null,
      explanation,
    });
  }
}
