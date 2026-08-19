import type { MistakeReplayContext } from "../shared/contracts/player-mistakes";
import { buildSnapshots } from "./decoder";
import { deriveReplayMetadata } from "./metadata";
import { parseRrrocketReplay } from "./rrrocket-adapter";
import { createReplayTimeline, replayStateAt } from "./timeline";

const SAMPLE_INTERVAL_SECONDS = 0.25;
const CONTEXT_SECONDS = 12;
const TIME_EPSILON = 1e-6;

export function createMistakeContextSampler(replay: unknown): (endSeconds: number) => MistakeReplayContext {
  const parsed = parseRrrocketReplay(replay);
  const snapshots = buildSnapshots(parsed);
  const timeline = createReplayTimeline(snapshots);
  const goalTimes = deriveReplayMetadata(parsed, snapshots).goals
    .map(goal => goal.time)
    .sort((left, right) => left - right);

  return requestedEndSeconds => {
    const endSeconds = Math.max(timeline.startTime, Math.min(timeline.endTime, requestedEndSeconds));
    const goalBoundarySeconds = goalTimes.filter(time => time < endSeconds - TIME_EPSILON).at(-1) ?? null;
    const lowerBound = Math.max(
      timeline.startTime,
      endSeconds - CONTEXT_SECONDS,
      goalBoundarySeconds ?? timeline.startTime,
    );
    const sampleTimes: number[] = [];
    for (let time = endSeconds; time >= lowerBound - TIME_EPSILON; time -= SAMPLE_INTERVAL_SECONDS) {
      sampleTimes.push(Number(time.toFixed(6)));
    }
    sampleTimes.reverse();

    return {
      sampleIntervalSeconds: SAMPLE_INTERVAL_SECONDS,
      startSeconds: sampleTimes[0] ?? endSeconds,
      endSeconds,
      goalBoundarySeconds,
      samples: sampleTimes.map(timeSeconds => {
        const state = replayStateAt(timeline, timeSeconds);
        return {
          timeSeconds,
          ball: state.ball,
          players: state.cars.map(car => ({
            actorId: car.id,
            displayName: car.name,
            team: car.team === 0 ? "blue" as const : "orange" as const,
            position: { x: car.x, y: car.y, z: car.z },
            yaw: car.yaw,
            rotation: car.rotation,
          })),
        };
      }),
    };
  };
}
