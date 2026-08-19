import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { replayData, validBundle } from "../../test/fixtures";
import { smallReplayFixture } from "../../test/replay-fixture";
import { replayAnalysisBundleV2Schema, type ReplayAnalysisBundleV2 } from "../../shared/contracts/replay-analysis-v2";
import { rrrocketReplaySchema } from "../../shared/contracts/rrrocket";
import { RRROCKET_OBJECT_NAMES } from "../../replay/rrrocket-adapter";
import { SqliteReplayRepository } from "./sqlite-replay-repository";

const repositories: SqliteReplayRepository[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(repositories.splice(0).map(repository => repository.close()));
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

async function setup(): Promise<SqliteReplayRepository> {
  const directory = await mkdtemp(join(tmpdir(), "replay-sqlite-test-"));
  directories.push(directory);
  const repository = new SqliteReplayRepository(join(directory, "replays.sqlite"));
  repositories.push(repository);
  return repository;
}

function mistakeBundle(id = "replay-1"): ReplayAnalysisBundleV2 {
  const bundle = replayAnalysisBundleV2Schema.parse(validBundle());
  bundle.replay.id = id;
  bundle.replay.dataUrl = `/api/replays/${id}/data`;
  bundle.analysis.teams[0].players = [{ id: "player-alpha", displayName: "Alpha" }];
  bundle.analysis.teams[0].events = [{
    id: "blue-conceded-1",
    relation: "conceded",
    ordinal: 1,
    occurredAtSeconds: 55,
    findings: [{
      id: "finding-sustained",
      kind: "disagreement",
      tone: "negative",
      text: "Alpha engaged before recovering.",
      subject: { playerId: "player-alpha", displayName: "Alpha" },
      navigation: { anchorSeconds: 50, preRollSeconds: 3 },
      extensions: { mistake: {
        expectedFamily: "RECOVER", actualFamily: "ENGAGE",
        expectedIntent: "CLOSE_ROTATE", actualIntent: "CHALLENGE",
        score: 1.5, sampleCount: 3, window: "1-2s",
        startTimeSeconds: 50, endTimeSeconds: 50.5,
        confidence: { expected: 0.8, actual: 0.75 }, sustained: true,
      } },
    }, {
      id: "finding-warning",
      kind: "disagreement",
      tone: "negative",
      text: "Weak fallback.",
      subject: { playerId: "player-alpha", displayName: "Alpha" },
      extensions: { mistake: {
        expectedFamily: "CONTAIN", actualFamily: "ENGAGE",
        expectedIntent: "SHADOW", actualIntent: "PRESSURE",
        score: 0.2, sampleCount: 1, window: "0-1s",
        startTimeSeconds: 52, endTimeSeconds: 52,
        confidence: { expected: 0.6, actual: 0.6 }, sustained: false,
      } },
    }],
  }];
  return bundle;
}

describe("SqliteReplayRepository", () => {
  it("stores historical replay data and returns creator-scoped duplicate bundles", async () => {
    const repository = await setup();
    const bundle = mistakeBundle();
    await repository.publish({ id: "replay-1", contentHash: "same", createdBy: "johndoe", filename: "one.replay", replay: replayData, bundle });
    expect(await repository.getReplay("replay-1", "johndoe")).toEqual(replayData);
    expect(await repository.getBundle("replay-1", "johndoe")).toEqual(bundle);
    expect(await repository.getReplay("replay-1", "someone-else")).toBeUndefined();
    expect(await repository.getBundle("replay-1", "someone-else")).toBeUndefined();
    expect(await repository.findBundleByHash("johndoe", "same")).toEqual(bundle);
    expect(await repository.findBundleByHash("someone-else", "same")).toBeUndefined();
  });

  it("lists newest replays and only lets their creator delete them", async () => {
    const repository = await setup();
    const older = mistakeBundle("older");
    older.analysis.generatedAt = "2026-08-18T12:00:00.000Z";
    const newer = mistakeBundle("newer");
    newer.analysis.generatedAt = "2026-08-19T12:00:00.000Z";
    await repository.publish({ id: "older", contentHash: "older-hash", createdBy: "owner", filename: "older.replay", replay: replayData, bundle: older });
    await repository.publish({ id: "newer", contentHash: "newer-hash", createdBy: "owner", filename: "newer.replay", replay: replayData, bundle: newer });

    expect((await repository.listReplays("owner")).map(replay => replay.id)).toEqual(["newer", "older"]);
    expect((await repository.getPlayerMistakes("Alpha", "owner", 1)).replayCount).toBe(1);
    expect(await repository.listReplays("other")).toEqual([]);
    expect(await repository.deleteReplay("newer", "other")).toBe(false);
    expect(await repository.deleteReplay("newer", "owner")).toBe(true);
    expect(await repository.getBundle("newer", "owner")).toBeUndefined();
    expect((await repository.getPlayerMistakes("Alpha", "owner", 50)).replayCount).toBe(1);
  });

  it("returns all sustained mistakes for a case-insensitive username", async () => {
    const repository = await setup();
    const bundle = mistakeBundle();
    await repository.publish({ id: "replay-1", contentHash: "hash", createdBy: "johndoe", filename: "ranked.replay", replay: replayData, bundle });
    const result = await repository.getPlayerMistakes("alpha", "johndoe", 50);
    expect(result).toMatchObject({ totalMistakes: 1, replayCount: 1, playerIds: ["player-alpha"] });
    expect(result.tacticalFocus).toEqual([expect.objectContaining({ expectedFamily: "RECOVER", actualFamily: "ENGAGE", count: 1 })]);
    expect(result.decisionHabits).toEqual([expect.objectContaining({ expectedIntent: "CLOSE_ROTATE", actualIntent: "CHALLENGE", count: 1 })]);
    expect(result.mistakes[0]).toMatchObject({ replayId: "replay-1", replayFilename: "ranked.replay", score: 1.5 });
    expect(await repository.getPlayerMistakes("Alpha", "someone-else", 50)).toMatchObject({ totalMistakes: 0, replayCount: 0 });
  });

  it("stores quarter-second replay context without crossing the previous goal", async () => {
    const repository = await setup();
    const bundle = mistakeBundle();
    bundle.analysis.teams[0].events[0].occurredAtSeconds = 15;
    const mistake = bundle.analysis.teams[0].events[0].findings[0].extensions?.mistake;
    if (!mistake) throw new Error("Expected mistake fixture.");
    mistake.startTimeSeconds = 14;
    mistake.endTimeSeconds = 14.5;

    const replay = smallReplayFixture();
    replay.objects.push(RRROCKET_OBJECT_NAMES.ball);
    replay.network_frames.frames[0].new_actors.push({
      actor_id: 400,
      object_id: replay.objects.length - 1,
      initial_trajectory: { location: { x: 100, y: 200, z: 93 } },
    });

    await repository.publish({
      id: "replay-1",
      contentHash: "context-hash",
      createdBy: "johndoe",
      filename: "context.replay",
      replay: rrrocketReplaySchema.parse(replay),
      bundle,
    });
    const [saved] = (await repository.getPlayerMistakes("Alpha", "johndoe", 50)).mistakes;

    expect(saved.replayContext).toMatchObject({
      sampleIntervalSeconds: 0.25,
      startSeconds: 5,
      endSeconds: 14,
      goalBoundarySeconds: 5,
    });
    expect(saved.replayContext?.samples).toHaveLength(37);
    expect(saved.replayContext?.samples[0]).toMatchObject({
      timeSeconds: 5,
      ball: { x: 100, y: 200, z: 93 },
      players: [{ displayName: "Alpha", team: "blue", position: { x: 0, y: 0, z: 17 } }],
    });
  });

  it("omits same-family comparisons from tactical focus", async () => {
    const repository = await setup();
    const bundle = mistakeBundle();
    const finding = bundle.analysis.teams[0].events[0].findings[0];
    if (!finding.extensions?.mistake) throw new Error("Expected mistake fixture.");
    finding.extensions.mistake.expectedFamily = "RECOVER";
    finding.extensions.mistake.actualFamily = "RECOVER";
    finding.extensions.mistake.expectedIntent = "FAR_ROTATE";
    finding.extensions.mistake.actualIntent = "CLOSE_ROTATE";
    await repository.publish({ id: "replay-1", contentHash: "hash", createdBy: "johndoe", filename: "rotation.replay", replay: replayData, bundle });
    const result = await repository.getPlayerMistakes("Alpha", "johndoe", 50);
    expect(result.tacticalFocus).toEqual([]);
    expect(result.decisionHabits).toEqual([expect.objectContaining({ expectedIntent: "FAR_ROTATE", actualIntent: "CLOSE_ROTATE", count: 1 })]);
  });

  it("stores an explanation with the mistake and scopes updates by creator", async () => {
    const repository = await setup();
    await repository.publish({ id: "replay-1", contentHash: "hash", createdBy: "johndoe", filename: "ranked.replay", replay: replayData, bundle: mistakeBundle() });
    const [mistake] = (await repository.getPlayerMistakes("Alpha", "johndoe", 50)).mistakes;
    const explanation = {
      text: "Rotate back before challenging.", generatedAt: "2026-08-19T12:00:00.000Z", model: "gpt-5.6", promptVersion: "1",
    };
    expect(await repository.saveMistakeExplanation(mistake.id, "someone-else", explanation)).toBeUndefined();
    expect(await repository.saveMistakeExplanation(mistake.id, "johndoe", explanation)).toEqual(explanation);
    expect((await repository.getMistake(mistake.id, "johndoe"))?.explanation).toEqual(explanation);
    expect((await repository.getPlayerMistakes("Alpha", "johndoe", 50)).mistakes[0].explanation).toEqual(explanation);
  });
});
