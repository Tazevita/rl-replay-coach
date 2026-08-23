import type {
  PlayerPrediction,
  PlayerPredictionHorizon,
  PlayerPredictionSample,
  PlayerPredictions,
} from "../shared/contracts/replay-analysis-v2";
import type { ProjectedCar, Vector3Data } from "./types";

export type PredictionHorizon = "0-1" | "1-2" | "2-3.5";

const CAR_GROUND_Z = 17.01;

export const PREDICTION_HORIZONS: ReadonlyArray<{
  id: PredictionHorizon;
  label: string;
  startSeconds: number;
  endSeconds: number;
}> = [
  { id: "0-1", label: "0-1s (+1s spot)", startSeconds: 0, endSeconds: 1 },
  { id: "1-2", label: "1-2s (+2s spot)", startSeconds: 1, endSeconds: 2 },
  { id: "2-3.5", label: "2-3.5s (+3.5s spot)", startSeconds: 2, endSeconds: 3.5 },
];

export const EMPTY_PLAYER_PREDICTIONS: PlayerPredictions = Object.freeze({
  sampleIntervalSeconds: 1,
  players: [],
});

export function projectedCarsAt(
  predictions: PlayerPredictions,
  playhead: number,
  horizonId: PredictionHorizon,
  selectedPlayerIds: ReadonlySet<string>,
): ProjectedCar[] {
  const window = PREDICTION_HORIZONS.find(item => item.id === horizonId)!;
  return predictions.players.flatMap(player => {
    if (!selectedPlayerIds.has(player.id)) return [];
    const samples = surroundingSamples(player, playhead);
    if (!samples.before || samples.before.status !== "available") return [];
    const before = matchingHorizon(samples.before, window.startSeconds, window.endSeconds);
    if (!before) return [];

    let position = before.position;
    let forward = before.forward;
    const gap = samples.after ? samples.after.anchorSeconds - samples.before.anchorSeconds : Infinity;
    if (samples.after?.status === "available" && gap > 0 && gap <= predictions.sampleIntervalSeconds * 1.5) {
      const after = matchingHorizon(samples.after, window.startSeconds, window.endSeconds);
      if (after) {
        const amount = Math.min(1, Math.max(0, (playhead - samples.before.anchorSeconds) / gap));
        position = interpolateVector(before.position, after.position, amount);
        forward = normalize(interpolateVector(before.forward, after.forward, amount));
      }
    }

    return [{
      id: player.id,
      name: player.displayName,
      team: player.team === "blue" ? 0 : 1,
      ...position,
      z: Math.max(position.z, CAR_GROUND_Z),
      yaw: Math.atan2(forward.y, forward.x),
    }];
  });
}

function surroundingSamples(player: PlayerPrediction, playhead: number): {
  before: PlayerPredictionSample | undefined;
  after: PlayerPredictionSample | undefined;
} {
  let before: PlayerPredictionSample | undefined;
  let after: PlayerPredictionSample | undefined;
  for (const sample of player.samples) {
    if (sample.anchorSeconds <= playhead) before = sample;
    else {
      after = sample;
      break;
    }
  }
  return { before, after };
}

function matchingHorizon(sample: PlayerPredictionSample, start: number, end: number): PlayerPredictionHorizon | undefined {
  return sample.horizons.find(item => item.window.startSeconds === start && item.window.endSeconds === end);
}

function interpolateVector(left: Vector3Data, right: Vector3Data, amount: number): Vector3Data {
  return {
    x: left.x + (right.x - left.x) * amount,
    y: left.y + (right.y - left.y) * amount,
    z: left.z + (right.z - left.z) * amount,
  };
}

function normalize(vector: Vector3Data): Vector3Data {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return length > 0 ? { x: vector.x / length, y: vector.y / length, z: vector.z / length } : { x: 1, y: 0, z: 0 };
}
