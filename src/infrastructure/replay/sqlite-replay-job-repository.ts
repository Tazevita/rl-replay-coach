import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import sqlite3 from "sqlite3";
import type { ReplayJobRepository } from "../../application/ports";
import { replayJobSchema, type ReplayJob, type ReplayJobStatus } from "../../shared/contracts/replay-job";
import type { ReplayAnalysisBundleV2 } from "../../shared/contracts/replay-analysis-v2";

type SqlValue = string | null;

interface ReplayJobRow {
  id: string;
  status: ReplayJobStatus;
  result_json: string | null;
  error: string | null;
}

export class SqliteReplayJobRepository implements ReplayJobRepository {
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
    await this.run("PRAGMA journal_mode = WAL");
    await this.run(`
      CREATE TABLE IF NOT EXISTS replay_jobs (
        id TEXT PRIMARY KEY,
        created_by TEXT NOT NULL,
        status TEXT NOT NULL,
        result_json TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await this.run("CREATE INDEX IF NOT EXISTS replay_jobs_creator ON replay_jobs(created_by, created_at)");
  }

  async create(record: { id: string; createdBy: string; createdAt: string }): Promise<void> {
    await this.ensureReady();
    await this.run(
      "INSERT INTO replay_jobs (id, created_by, status, created_at, updated_at) VALUES (?, ?, 'queued', ?, ?)",
      [record.id, record.createdBy, record.createdAt, record.createdAt],
    );
  }

  async setStatus(id: string, createdBy: string, status: ReplayJobStatus, updatedAt: string): Promise<void> {
    await this.ensureReady();
    await this.run("UPDATE replay_jobs SET status = ?, updated_at = ? WHERE id = ? AND created_by = ?", [status, updatedAt, id, createdBy]);
  }

  async complete(id: string, createdBy: string, result: ReplayAnalysisBundleV2, updatedAt: string): Promise<void> {
    await this.ensureReady();
    await this.run(
      "UPDATE replay_jobs SET status = 'completed', result_json = ?, error = NULL, updated_at = ? WHERE id = ? AND created_by = ?",
      [JSON.stringify(result), updatedAt, id, createdBy],
    );
  }

  async fail(id: string, createdBy: string, error: string, updatedAt: string): Promise<void> {
    await this.ensureReady();
    await this.run(
      "UPDATE replay_jobs SET status = 'failed', error = ?, result_json = NULL, updated_at = ? WHERE id = ? AND created_by = ?",
      [error, updatedAt, id, createdBy],
    );
  }

  async get(id: string, createdBy: string): Promise<ReplayJob | undefined> {
    await this.ensureReady();
    const row = await new Promise<ReplayJobRow | undefined>((resolve, reject) => {
      this.database!.get(
        "SELECT id, status, result_json, error FROM replay_jobs WHERE id = ? AND created_by = ?",
        [id, createdBy],
        (error, result) => error ? reject(error) : resolve(result as ReplayJobRow | undefined),
      );
    });
    if (!row) return undefined;
    if (row.status === "completed") return replayJobSchema.parse({ jobId: row.id, status: row.status, result: JSON.parse(row.result_json ?? "null") });
    if (row.status === "failed") return replayJobSchema.parse({ jobId: row.id, status: row.status, error: row.error ?? "Replay processing failed." });
    return replayJobSchema.parse({ jobId: row.id, status: row.status });
  }

  private async run(sql: string, parameters: SqlValue[] = []): Promise<void> {
    if (!this.database) throw new Error("SQLite database is not open.");
    await new Promise<void>((resolve, reject) => {
      this.database!.run(sql, parameters, error => error ? reject(error) : resolve());
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
