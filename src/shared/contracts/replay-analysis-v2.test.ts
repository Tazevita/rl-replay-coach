import { describe, expect, it } from "vitest";
import { validBundle } from "../../test/fixtures";
import { replayAnalysisBundleV2Schema } from "./replay-analysis-v2";

describe("ReplayAnalysisBundleV2", () => {
  it("accepts a valid versioned bundle with player predictions", () => {
    expect(replayAnalysisBundleV2Schema.parse(validBundle())).toEqual(validBundle());
  });

  it("rejects other public schema versions and missing replay identity", () => {
    expect(replayAnalysisBundleV2Schema.safeParse({ ...validBundle(), schemaVersion: 1 }).success).toBe(false);
    const missingId = validBundle() as Record<string, any>;
    delete missingId.replay.id;
    expect(replayAnalysisBundleV2Schema.safeParse(missingId).success).toBe(false);
  });

  it("rejects invalid prediction vectors and statuses", () => {
    const invalidVector = validBundle();
    invalidVector.analysis.playerPredictions.players[0].samples[0].horizons[0].forward.x = Number.NaN;
    expect(replayAnalysisBundleV2Schema.safeParse(invalidVector).success).toBe(false);

    const invalidStatus = validBundle();
    invalidStatus.analysis.playerPredictions.players[0].samples[0].status = "pending" as "available";
    expect(replayAnalysisBundleV2Schema.safeParse(invalidStatus).success).toBe(false);

    const unavailableWithHorizons = validBundle();
    unavailableWithHorizons.analysis.playerPredictions.players[0].samples[0].status = "unavailable" as "available";
    expect(replayAnalysisBundleV2Schema.safeParse(unavailableWithHorizons).success).toBe(false);
  });

  it("rejects invalid teams and timestamps", () => {
    const invalidTeam = validBundle();
    invalidTeam.analysis.teams[0].team.id = "green" as "blue";
    expect(replayAnalysisBundleV2Schema.safeParse(invalidTeam).success).toBe(false);
    const invalidTime = validBundle();
    invalidTime.analysis.teams[0].events[0].occurredAtSeconds = -1;
    expect(replayAnalysisBundleV2Schema.safeParse(invalidTime).success).toBe(false);
  });

  it("retains finding extension fields", () => {
    const bundle = validBundle();
    Object.assign(bundle.analysis.teams[0].events[0].findings[0], {
      extensions: { experimentalMetric: 0.75 },
    });
    expect(replayAnalysisBundleV2Schema.parse(bundle).analysis.teams[0].events[0].findings[0].extensions)
      .toEqual({ experimentalMetric: 0.75 });
  });
});
