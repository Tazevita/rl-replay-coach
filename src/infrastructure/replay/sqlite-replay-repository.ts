import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import sqlite3 from "sqlite3";
import type { ReplayRepository } from "../../application/ports";
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
import { createMistakeContextSampler } from "../../replay/mistake-context";
import { replayHistorySchema, type ReplayHistoryItem } from "../../shared/contracts/replay-history";

type SqlValue = string | number | null;

interface MistakeRow {
  id: string;
  replay_id: string;
  filename: string;
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
  text: string;
  analyzed_at: string;
  context_json: string | null;
  explanation_text: string | null;
  explanation_generated_at: string | null;
  explanation_model: string | null;
  explanation_prompt_version: string | null;
  start_time_seconds?: number;
  replay_json?: string;
}

export class SqliteReplayRepository implements ReplayRepository {
  private ready: Promise<void> | undefined;
  private database: sqlite3.Database | undefined;

  constructor(private readonly databasePath: string) {}

  private async ensureReady(): Promise<void> {
    this.ready ??= this.initialize();
    await this.ready;
  }

  private async initialize(): Promise<void> {
    if (this.databasePath !== ":memory:") await mkdir(dirname(this.databasePath), { recursive: true });
    this.database = await new Promise<sqlite3.Database>((resolve, reject) => {
      const database = new sqlite3.Database(this.databasePath, error => error ? reject(error) : resolve(database));
    });
    await this.run("PRAGMA foreign_keys = ON");
    await this.run("PRAGMA journal_mode = WAL");
    await this.run(`
      CREATE TABLE IF NOT EXISTS replays (
        id TEXT PRIMARY KEY,
        content_hash TEXT NOT NULL,
        filename TEXT NOT NULL,
        created_by TEXT NOT NULL,
        analyzed_at TEXT NOT NULL,
        replay_json TEXT NOT NULL,
        bundle_json TEXT NOT NULL,
        UNIQUE (created_by, content_hash)
      )
    `);
    await this.run(`
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await this.run(`
      CREATE TABLE IF NOT EXISTS replay_players (
        replay_id TEXT NOT NULL REFERENCES replays(id) ON DELETE CASCADE,
        player_id TEXT NOT NULL REFERENCES players(id),
        display_name TEXT NOT NULL,
        team TEXT NOT NULL,
        PRIMARY KEY (replay_id, player_id)
      )
    `);
    await this.run(`
      CREATE TABLE IF NOT EXISTS mistakes (
        replay_id TEXT NOT NULL REFERENCES replays(id) ON DELETE CASCADE,
        finding_id TEXT NOT NULL,
        player_id TEXT NOT NULL REFERENCES players(id),
        display_name TEXT NOT NULL,
        event_id TEXT NOT NULL,
        occurred_at_seconds REAL NOT NULL,
        anchor_seconds REAL NOT NULL,
        expected_family TEXT NOT NULL,
        actual_family TEXT NOT NULL,
        expected_intent TEXT NOT NULL,
        actual_intent TEXT NOT NULL,
        score REAL NOT NULL,
        sample_count INTEGER NOT NULL,
        window TEXT NOT NULL,
        start_time_seconds REAL NOT NULL,
        end_time_seconds REAL NOT NULL,
        expected_confidence REAL NOT NULL,
        actual_confidence REAL NOT NULL,
        text TEXT NOT NULL,
        context_json TEXT,
        explanation_text TEXT,
        explanation_generated_at TEXT,
        explanation_model TEXT,
        explanation_prompt_version TEXT,
        PRIMARY KEY (replay_id, finding_id)
      )
    `);
    const mistakeColumns = await this.all<{ name: string }>("PRAGMA table_info(mistakes)");
    if (!mistakeColumns.some(column => column.name === "context_json")) {
      await this.run("ALTER TABLE mistakes ADD COLUMN context_json TEXT");
    }
    for (const column of ["explanation_text", "explanation_generated_at", "explanation_model", "explanation_prompt_version"]) {
      if (!mistakeColumns.some(existing => existing.name === column)) {
        await this.run(`ALTER TABLE mistakes ADD COLUMN ${column} TEXT`);
      }
    }
    await this.run("CREATE INDEX IF NOT EXISTS replay_players_name ON replay_players(display_name COLLATE NOCASE)");
    await this.run("CREATE INDEX IF NOT EXISTS mistakes_player ON mistakes(player_id)");
    await this.run("CREATE INDEX IF NOT EXISTS replays_creator ON replays(created_by)");
  }

  private async run(sql: string, parameters: SqlValue[] = []): Promise<void> {
    if (!this.database) throw new Error("SQLite database is not open.");
    await new Promise<void>((resolve, reject) => {
      this.database!.run(sql, parameters, error => error ? reject(error) : resolve());
    });
  }

  private async get<T>(sql: string, parameters: SqlValue[] = []): Promise<T | undefined> {
    if (!this.database) throw new Error("SQLite database is not open.");
    return await new Promise<T | undefined>((resolve, reject) => {
      this.database!.get(sql, parameters, (error, row) => error ? reject(error) : resolve(row as T | undefined));
    });
  }

  private async all<T>(sql: string, parameters: SqlValue[] = []): Promise<T[]> {
    if (!this.database) throw new Error("SQLite database is not open.");
    return await new Promise<T[]>((resolve, reject) => {
      this.database!.all(sql, parameters, (error, rows) => error ? reject(error) : resolve(rows as T[]));
    });
  }

  async findBundleByHash(createdBy: string, contentHash: string): Promise<ReplayAnalysisBundleV2 | undefined> {
    await this.ensureReady();
    const row = await this.get<{ bundle_json: string }>(
      "SELECT bundle_json FROM replays WHERE created_by = ? AND content_hash = ?",
      [createdBy, contentHash],
    );
    return row ? replayAnalysisBundleV2Schema.parse(JSON.parse(row.bundle_json)) : undefined;
  }

  async listReplays(createdBy: string): Promise<ReplayHistoryItem[]> {
    await this.ensureReady();
    const rows = await this.all<{ id: string; filename: string; analyzed_at: string }>(
      "SELECT id, filename, analyzed_at FROM replays WHERE created_by = ? ORDER BY analyzed_at DESC",
      [createdBy],
    );
    return replayHistorySchema.parse(rows.map(row => ({
      id: row.id,
      filename: row.filename,
      analyzedAt: new Date(row.analyzed_at).toISOString(),
    })));
  }

  async deleteReplay(id: string, createdBy: string): Promise<boolean> {
    await this.ensureReady();
    const replay = await this.get<{ id: string }>("SELECT id FROM replays WHERE id = ? AND created_by = ?", [id, createdBy]);
    if (!replay) return false;
    await this.run("DELETE FROM replays WHERE id = ? AND created_by = ?", [id, createdBy]);
    return true;
  }

  async publish(record: {
    id: string;
    contentHash: string;
    createdBy: string;
    filename: string;
    replay: RrrocketReplay;
    bundle: ReplayAnalysisBundleV2;
  }): Promise<ReplayAnalysisBundleV2> {
    await this.ensureReady();
    const sampleContext = createMistakeContextSampler(record.replay);
    await this.run("BEGIN IMMEDIATE");
    try {
      await this.run(
        "INSERT INTO replays (id, content_hash, filename, created_by, analyzed_at, replay_json, bundle_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [record.id, record.contentHash, record.filename, record.createdBy, record.bundle.analysis.generatedAt, JSON.stringify(record.replay), JSON.stringify(record.bundle)],
      );
      for (const team of record.bundle.analysis.teams) {
        for (const player of team.players) {
          if (!player.id) continue;
          await this.run(
            "INSERT INTO players (id, display_name, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at",
            [player.id, player.displayName, record.bundle.analysis.generatedAt],
          );
          await this.run(
            "INSERT INTO replay_players (replay_id, player_id, display_name, team) VALUES (?, ?, ?, ?)",
            [record.id, player.id, player.displayName, team.team.id],
          );
        }
        for (const event of team.events) {
          for (const finding of event.findings) {
            const mistake = finding.extensions?.mistake;
            if (finding.kind !== "disagreement" || !mistake?.sustained || !finding.subject?.playerId) continue;
            await this.run(
              `INSERT INTO mistakes (
                replay_id, finding_id, player_id, display_name, event_id, occurred_at_seconds,
                anchor_seconds, expected_family, actual_family, expected_intent, actual_intent,
                score, sample_count, window, start_time_seconds, end_time_seconds,
                expected_confidence, actual_confidence, text, context_json
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                record.id, finding.id, finding.subject.playerId, finding.subject.displayName,
                event.id, event.occurredAtSeconds, finding.navigation?.anchorSeconds ?? mistake.startTimeSeconds,
                mistake.expectedFamily, mistake.actualFamily, mistake.expectedIntent, mistake.actualIntent,
                mistake.score, mistake.sampleCount, mistake.window, mistake.startTimeSeconds, mistake.endTimeSeconds,
                mistake.confidence.expected, mistake.confidence.actual, finding.text,
                JSON.stringify(sampleContext(mistake.startTimeSeconds)),
              ],
            );
          }
        }
      }
      await this.run("COMMIT");
      return record.bundle;
    } catch (error) {
      await this.run("ROLLBACK");
      const existing = await this.findBundleByHash(record.createdBy, record.contentHash);
      if (existing) return existing;
      throw error;
    }
  }

  async getReplay(id: string, createdBy: string): Promise<RrrocketReplay | undefined> {
    await this.ensureReady();
    const row = await this.get<{ replay_json: string }>("SELECT replay_json FROM replays WHERE id = ? AND created_by = ?", [id, createdBy]);
    return row ? rrrocketReplaySchema.parse(JSON.parse(row.replay_json)) : undefined;
  }

  async getBundle(id: string, createdBy: string): Promise<ReplayAnalysisBundleV2 | undefined> {
    await this.ensureReady();
    const row = await this.get<{ bundle_json: string }>("SELECT bundle_json FROM replays WHERE id = ? AND created_by = ?", [id, createdBy]);
    return row ? replayAnalysisBundleV2Schema.parse(JSON.parse(row.bundle_json)) : undefined;
  }

  async getPlayerMistakes(username: string, createdBy: string, replayLimit: number): Promise<PlayerMistakesResponse> {
    await this.ensureReady();
    const replayRows = await this.all<{ id: string }>(
      "SELECT id FROM replays WHERE created_by = ? ORDER BY analyzed_at DESC LIMIT ?",
      [createdBy, replayLimit],
    );
    const replayIds = replayRows.map(replay => replay.id);
    if (!replayIds.length) {
      return playerMistakesResponseSchema.parse({
        username, createdBy, playerIds: [], replayCount: 0, totalMistakes: 0, tacticalFocus: [], decisionHabits: [], mistakes: [],
      });
    }
    const replayPlaceholders = replayIds.map(() => "?").join(", ");
    const identities = await this.all<{ player_id: string }>(
      `SELECT DISTINCT rp.player_id
       FROM replay_players rp
       JOIN replays r ON r.id = rp.replay_id
       WHERE rp.display_name = ? COLLATE NOCASE AND r.created_by = ?
         AND r.id IN (${replayPlaceholders})`,
      [username, createdBy, ...replayIds],
    );
    const playerIds = identities.map(identity => identity.player_id);
    if (!playerIds.length) {
      return playerMistakesResponseSchema.parse({
        username, createdBy, playerIds: [], replayCount: 0, totalMistakes: 0, tacticalFocus: [], decisionHabits: [], mistakes: [],
      });
    }
    const placeholders = playerIds.map(() => "?").join(", ");
    const rows = await this.all<MistakeRow>(
      `SELECT
         m.replay_id || ':' || m.finding_id AS id, m.replay_id, r.filename,
         m.player_id, m.display_name, m.event_id, m.occurred_at_seconds,
         m.anchor_seconds, m.expected_family, m.actual_family, m.expected_intent,
          m.actual_intent, m.score, m.sample_count, m.window, m.text, r.analyzed_at,
           m.context_json, m.explanation_text, m.explanation_generated_at,
           m.explanation_model, m.explanation_prompt_version
       FROM mistakes m
       JOIN replays r ON r.id = m.replay_id
        WHERE r.created_by = ? AND r.id IN (${replayPlaceholders}) AND m.player_id IN (${placeholders})
        ORDER BY r.analyzed_at DESC, m.occurred_at_seconds DESC`,
      [createdBy, ...replayIds, ...playerIds],
    );
    const tacticalFocus = new Map<string, { expectedFamily: string; actualFamily: string; count: number; score: number }>();
    const decisionHabits = new Map<string, { expectedIntent: string; actualIntent: string; count: number; score: number }>();
    for (const row of rows) {
      if (row.expected_family !== row.actual_family) {
        const focusKey = [row.expected_family, row.actual_family].join("\0");
        const focus = tacticalFocus.get(focusKey) ?? {
          expectedFamily: row.expected_family,
          actualFamily: row.actual_family,
          count: 0,
          score: 0,
        };
        focus.count += 1;
        focus.score += row.score;
        tacticalFocus.set(focusKey, focus);
      }

      const habitKey = [row.expected_intent, row.actual_intent].join("\0");
      const habit = decisionHabits.get(habitKey) ?? {
        expectedIntent: row.expected_intent,
        actualIntent: row.actual_intent,
        count: 0,
        score: 0,
      };
      habit.count += 1;
      habit.score += row.score;
      decisionHabits.set(habitKey, habit);
    }
    const replayCount = new Set(rows.map(row => row.replay_id)).size;
    return playerMistakesResponseSchema.parse({
      username,
      createdBy,
      playerIds,
      replayCount,
      totalMistakes: rows.length,
      tacticalFocus: [...tacticalFocus.values()]
        .sort((left, right) => right.count - left.count || right.score - left.score)
        .map(({ score, ...category }) => ({ ...category, averageScore: score / category.count })),
      decisionHabits: [...decisionHabits.values()]
        .sort((left, right) => right.count - left.count || right.score - left.score)
        .map(({ score, ...category }) => ({ ...category, averageScore: score / category.count })),
      mistakes: rows.map(row => this.toMistake(row)),
    });
  }

  async getMistake(id: string, createdBy: string): Promise<PlayerMistake | undefined> {
    await this.ensureReady();
    const row = await this.get<MistakeRow>(
      `SELECT
         m.replay_id || ':' || m.finding_id AS id, m.replay_id, r.filename,
         m.player_id, m.display_name, m.event_id, m.occurred_at_seconds,
         m.anchor_seconds, m.expected_family, m.actual_family, m.expected_intent,
         m.actual_intent, m.score, m.sample_count, m.window, m.text, r.analyzed_at,
         m.context_json, m.explanation_text, m.explanation_generated_at,
         m.explanation_model, m.explanation_prompt_version, m.start_time_seconds,
         r.replay_json
       FROM mistakes m
       JOIN replays r ON r.id = m.replay_id
       WHERE (m.replay_id || ':' || m.finding_id) = ? AND r.created_by = ?`,
      [id, createdBy],
    );
    if (!row) return undefined;
    const savedContext = row.context_json
      ? mistakeReplayContextSchema.parse(JSON.parse(row.context_json))
      : null;
    if (
      row.start_time_seconds !== undefined
      && row.replay_json
      && (!savedContext || Math.abs(savedContext.endSeconds - row.start_time_seconds) > 0.001)
    ) {
      const replay = rrrocketReplaySchema.parse(JSON.parse(row.replay_json));
      row.context_json = JSON.stringify(createMistakeContextSampler(replay)(row.start_time_seconds));
      await this.run(
        `UPDATE mistakes SET context_json = ?
         WHERE (replay_id || ':' || finding_id) = ?
           AND replay_id IN (SELECT id FROM replays WHERE created_by = ?)`,
        [row.context_json, id, createdBy],
      );
    }
    return this.toMistake(row);
  }

  async saveMistakeExplanation(
    id: string,
    createdBy: string,
    explanation: MistakeExplanation,
  ): Promise<MistakeExplanation | undefined> {
    await this.ensureReady();
    const value = mistakeExplanationSchema.parse(explanation);
    await this.run(
      `UPDATE mistakes SET
         explanation_text = ?, explanation_generated_at = ?, explanation_model = ?,
         explanation_prompt_version = ?
       WHERE (replay_id || ':' || finding_id) = ?
         AND explanation_text IS NULL
         AND replay_id IN (SELECT id FROM replays WHERE created_by = ?)`,
      [value.text, value.generatedAt, value.model, value.promptVersion, id, createdBy],
    );
    return (await this.getMistake(id, createdBy))?.explanation ?? undefined;
  }

  private toMistake(row: MistakeRow): PlayerMistake {
    const explanation = row.explanation_text
      && row.explanation_generated_at
      && row.explanation_model
      && row.explanation_prompt_version
      ? {
          text: row.explanation_text,
          generatedAt: row.explanation_generated_at,
          model: row.explanation_model,
          promptVersion: row.explanation_prompt_version,
        }
      : null;
    return playerMistakeSchema.parse({
      id: row.id,
      replayId: row.replay_id,
      replayFilename: row.filename,
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
      analyzedAt: row.analyzed_at,
      replayContext: row.context_json
        ? mistakeReplayContextSchema.parse(JSON.parse(row.context_json))
        : null,
      explanation,
    });
  }

  async close(): Promise<void> {
    if (!this.ready) return;
    await this.ready;
    if (!this.database) return;
    await new Promise<void>((resolve, reject) => this.database!.close(error => error ? reject(error) : resolve()));
    this.database = undefined;
  }
}
