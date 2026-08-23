import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
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
import { replayHistorySchema, type ReplayHistoryItem } from "../../shared/contracts/replay-history";
import { rrrocketReplaySchema, type RrrocketReplay } from "../../shared/contracts/rrrocket";

type MistakeRow = Awaited<ReturnType<PrismaClient["mistake"]["findFirst"]>> & {};

export class PrismaReplayRepository implements ReplayRepository {
  constructor(private readonly client: PrismaClient, private readonly replayDirectory: string) {}

  async findBundleByHash(createdBy: string, contentHash: string): Promise<ReplayAnalysisBundleV2 | undefined> {
    const row = await this.client.replay.findUnique({ where: { createdBy_contentHash: { createdBy, contentHash } }, select: { bundle: true } });
    return row ? replayAnalysisBundleV2Schema.parse(JSON.parse(row.bundle)) : undefined;
  }

  async listReplays(createdBy: string): Promise<ReplayHistoryItem[]> {
    const rows = await this.client.replay.findMany({ where: { createdBy }, orderBy: { analyzedAt: "desc" } });
    return replayHistorySchema.parse(rows.map(row => ({ id: row.id, filename: row.filename, analyzedAt: row.analyzedAt.toISOString() })));
  }

  async deleteReplay(id: string, createdBy: string): Promise<boolean> {
    const row = await this.client.replay.findFirst({ where: { id, createdBy }, select: { replayPath: true } });
    if (!row) return false;
    await this.client.replay.delete({ where: { id } });
    await rm(row.replayPath, { force: true });
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
    const existing = await this.findBundleByHash(record.createdBy, record.contentHash);
    if (existing) return existing;

    await mkdir(this.replayDirectory, { recursive: true });
    const replayPath = join(this.replayDirectory, `${record.id}.json`);
    await writeFile(replayPath, JSON.stringify(record.replay));
    const sampleContext = createMistakeContextSampler(record.replay);
    const players = record.bundle.analysis.teams.flatMap(team => team.players
      .filter(player => player.id)
      .map(player => ({ replayId: record.id, playerId: player.id!, displayName: player.displayName, team: team.team.id })));
    const mistakes = record.bundle.analysis.teams.flatMap(team => team.events.flatMap(event => event.findings.flatMap(finding => {
      const mistake = finding.extensions?.mistake;
      if (finding.kind !== "disagreement" || !mistake || !finding.subject?.playerId) return [];
      return [{
        id: `${record.id}:${finding.id}`,
        replayId: record.id,
        findingId: finding.id,
        playerId: finding.subject.playerId,
        displayName: finding.subject.displayName,
        eventId: event.id,
        occurredAtSeconds: event.occurredAtSeconds,
        anchorSeconds: finding.navigation?.anchorSeconds ?? mistake.startTimeSeconds,
        expectedFamily: mistake.expectedFamily,
        actualFamily: mistake.actualFamily,
        expectedIntent: mistake.expectedIntent,
        actualIntent: mistake.actualIntent,
        score: mistake.score,
        sampleCount: mistake.sampleCount,
        window: mistake.window,
        startTimeSeconds: mistake.startTimeSeconds,
        text: finding.text,
        context: JSON.stringify(sampleContext(event.occurredAtSeconds)),
      }];
    })));

    try {
      await this.client.$transaction(async transaction => {
        await transaction.replay.create({ data: {
          id: record.id,
          contentHash: record.contentHash,
          createdBy: record.createdBy,
          filename: record.filename,
          analyzedAt: new Date(record.bundle.analysis.generatedAt),
          replayPath,
          bundle: JSON.stringify(record.bundle),
        } });
        if (players.length) await transaction.replayPlayer.createMany({ data: players });
        if (mistakes.length) await transaction.mistake.createMany({ data: mistakes });
      });
    } catch (error) {
      await rm(replayPath, { force: true });
      const duplicate = await this.findBundleByHash(record.createdBy, record.contentHash);
      if (duplicate) return duplicate;
      throw error;
    }
    return record.bundle;
  }

  async getReplay(id: string, createdBy: string): Promise<RrrocketReplay | undefined> {
    const row = await this.client.replay.findFirst({ where: { id, createdBy }, select: { replayPath: true } });
    return row ? rrrocketReplaySchema.parse(JSON.parse(await readFile(row.replayPath, "utf8"))) : undefined;
  }

  async getBundle(id: string, createdBy: string): Promise<ReplayAnalysisBundleV2 | undefined> {
    const row = await this.client.replay.findFirst({ where: { id, createdBy }, select: { bundle: true } });
    return row ? replayAnalysisBundleV2Schema.parse(JSON.parse(row.bundle)) : undefined;
  }

  async getPlayerMistakes(username: string, createdBy: string, replayLimit: number): Promise<PlayerMistakesResponse> {
    const replays = await this.client.replay.findMany({
      where: { createdBy },
      orderBy: { analyzedAt: "desc" },
      take: replayLimit,
      include: { players: true, mistakes: true },
    });
    const normalized = username.toLocaleLowerCase();
    const playerIds = [...new Set(replays.flatMap(replay => replay.players)
      .filter(player => player.displayName.toLocaleLowerCase() === normalized)
      .map(player => player.playerId))];
    const rows = replays.flatMap(replay => replay.mistakes
      .filter(mistake => playerIds.includes(mistake.playerId))
      .map(mistake => ({ mistake, replay })))
      .sort((left, right) => right.replay.analyzedAt.getTime() - left.replay.analyzedAt.getTime()
        || right.mistake.occurredAtSeconds - left.mistake.occurredAtSeconds);
    const tacticalFocus = new Map<string, { expectedFamily: string; actualFamily: string; count: number; score: number }>();
    const decisionHabits = new Map<string, { expectedIntent: string; actualIntent: string; count: number; score: number }>();
    for (const { mistake } of rows) {
      if (mistake.expectedFamily !== mistake.actualFamily) {
        const key = `${mistake.expectedFamily}\0${mistake.actualFamily}`;
        const value = tacticalFocus.get(key) ?? { expectedFamily: mistake.expectedFamily, actualFamily: mistake.actualFamily, count: 0, score: 0 };
        value.count += 1;
        value.score += mistake.score;
        tacticalFocus.set(key, value);
      }
      const key = `${mistake.expectedIntent}\0${mistake.actualIntent}`;
      const value = decisionHabits.get(key) ?? { expectedIntent: mistake.expectedIntent, actualIntent: mistake.actualIntent, count: 0, score: 0 };
      value.count += 1;
      value.score += mistake.score;
      decisionHabits.set(key, value);
    }
    return playerMistakesResponseSchema.parse({
      username,
      createdBy,
      playerIds,
      replayCount: new Set(rows.map(row => row.replay.id)).size,
      totalMistakes: rows.length,
      tacticalFocus: [...tacticalFocus.values()].sort((a, b) => b.count - a.count || b.score - a.score)
        .map(({ score, ...value }) => ({ ...value, averageScore: score / value.count })),
      decisionHabits: [...decisionHabits.values()].sort((a, b) => b.count - a.count || b.score - a.score)
        .map(({ score, ...value }) => ({ ...value, averageScore: score / value.count })),
      mistakes: rows.map(({ mistake, replay }) => this.toMistake(mistake, replay)),
    });
  }

  async getMistake(id: string, createdBy: string): Promise<PlayerMistake | undefined> {
    const row = await this.client.mistake.findFirst({ where: { id, replay: { createdBy } }, include: { replay: true } });
    if (!row) return undefined;
    const savedContext = row.context ? mistakeReplayContextSchema.parse(JSON.parse(row.context)) : null;
    if (!savedContext || Math.abs(savedContext.endSeconds - row.occurredAtSeconds) > 0.001) {
      const replay = rrrocketReplaySchema.parse(JSON.parse(await readFile(row.replay.replayPath, "utf8")));
      row.context = JSON.stringify(createMistakeContextSampler(replay)(row.occurredAtSeconds));
      await this.client.mistake.update({ where: { id }, data: { context: row.context } });
    }
    return this.toMistake(row, row.replay);
  }

  async saveMistakeExplanation(id: string, createdBy: string, explanation: MistakeExplanation): Promise<MistakeExplanation | undefined> {
    if (!await this.getMistake(id, createdBy)) return undefined;
    const value = mistakeExplanationSchema.parse(explanation);
    await this.client.mistake.updateMany({
      where: { id },
      data: {
        explanationText: value.text,
        explanationGeneratedAt: new Date(value.generatedAt),
        explanationModel: value.model,
        explanationPromptVersion: value.promptVersion,
      },
    });
    return (await this.getMistake(id, createdBy))?.explanation ?? undefined;
  }

  private toMistake(row: NonNullable<MistakeRow>, replay: { id: string; filename: string; analyzedAt: Date }): PlayerMistake {
    return playerMistakeSchema.parse({
      id: row.id,
      replayId: row.replayId,
      replayFilename: replay.filename,
      playerId: row.playerId,
      displayName: row.displayName,
      eventId: row.eventId,
      occurredAtSeconds: row.occurredAtSeconds,
      anchorSeconds: row.anchorSeconds,
      expectedFamily: row.expectedFamily,
      actualFamily: row.actualFamily,
      expectedIntent: row.expectedIntent,
      actualIntent: row.actualIntent,
      score: row.score,
      sampleCount: row.sampleCount,
      window: row.window,
      text: row.text,
      analyzedAt: replay.analyzedAt.toISOString(),
      replayContext: row.context ? mistakeReplayContextSchema.parse(JSON.parse(row.context)) : null,
      explanation: row.explanationText && row.explanationGeneratedAt && row.explanationModel && row.explanationPromptVersion ? {
        text: row.explanationText,
        generatedAt: row.explanationGeneratedAt.toISOString(),
        model: row.explanationModel,
        promptVersion: row.explanationPromptVersion,
      } : null,
    });
  }
}
