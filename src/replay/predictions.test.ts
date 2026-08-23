import { describe, expect, it } from "vitest";
import type { PlayerPredictions } from "../shared/contracts/replay-analysis-v2";
import { projectedCarsAt } from "./predictions";

function predictions(): PlayerPredictions {
  const horizon = (startSeconds: number, endSeconds: number, x: number, forward = { x: 1, y: 0, z: 0 }) => ({
    window: { startSeconds, endSeconds },
    targetSeconds: endSeconds,
    position: { x, y: 20, z: 30 },
    forward,
  });
  return {
    sampleIntervalSeconds: 1,
    players: [{
      id: "alpha",
      displayName: "Alpha",
      team: "orange",
      samples: [
        { anchorSeconds: 1, status: "available", horizons: [horizon(0, 1, 100), horizon(1, 2, 200), horizon(2, 3.5, 350)] },
        { anchorSeconds: 2, status: "available", horizons: [horizon(0, 1, 300, { x: 0, y: 1, z: 0 }), horizon(1, 2, 400), horizon(2, 3.5, 550)] },
        { anchorSeconds: 3, status: "unavailable", horizons: [] },
      ],
    }],
  };
}

describe("projectedCarsAt", () => {
  it("filters players and selects the requested endpoint horizon", () => {
    expect(projectedCarsAt(predictions(), 1, "1-2", new Set())).toEqual([]);
    expect(projectedCarsAt(predictions(), 1, "1-2", new Set(["alpha"]))[0]).toMatchObject({
      id: "alpha", name: "Alpha", team: 1, x: 200, y: 20, z: 30,
    });
  });

  it("interpolates available samples and predicted facing", () => {
    const [projectedCar] = projectedCarsAt(predictions(), 1.5, "0-1", new Set(["alpha"]));
    expect(projectedCar.x).toBe(200);
    expect(projectedCar.yaw).toBeCloseTo(Math.PI / 4);
  });

  it("does not project unavailable or future-only samples", () => {
    expect(projectedCarsAt(predictions(), .5, "0-1", new Set(["alpha"]))).toEqual([]);
    expect(projectedCarsAt(predictions(), 3, "0-1", new Set(["alpha"]))).toEqual([]);
  });

  it("clamps below-ground predictions to the grounded car height", () => {
    const data = predictions();
    data.players[0].samples[0].horizons[0].position.z = -20;
    expect(projectedCarsAt(data, 1, "0-1", new Set(["alpha"]))[0].z).toBe(17.01);
  });
});
