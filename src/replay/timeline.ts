import type {
  InterpolatedReplayState,
  QuaternionData,
  ReplayCar,
  ReplayPlayer,
  ReplaySnapshot,
  Vector3Data,
} from "./types";

export interface ReplayTimeline {
  readonly snapshots: readonly ReplaySnapshot[];
  readonly startTime: number;
  readonly endTime: number;
  readonly duration: number;
}

const EMPTY_STATE: InterpolatedReplayState = { cars: [], ball: null, frameIndex: 0 };
const INTERPOLATION_GAP_SECONDS = .25;

export function createReplayTimeline(snapshots: readonly ReplaySnapshot[]): ReplayTimeline {
  const copy = [...snapshots];
  const startTime = copy[0]?.time ?? 0;
  const endTime = copy.at(-1)?.time ?? startTime;
  return Object.freeze({
    snapshots: Object.freeze(copy),
    startTime,
    endTime,
    duration: Math.max(0, endTime - startTime),
  });
}

export function clampTime(timeline: ReplayTimeline, time: number): number {
  if (!timeline.snapshots.length) return 0;
  if (!Number.isFinite(time)) return timeline.startTime;
  return Math.max(timeline.startTime, Math.min(timeline.endTime, time));
}

export function findSnapshotIndex(timeline: ReplayTimeline, time: number): number {
  if (!timeline.snapshots.length) return -1;
  let low = 0;
  let high = timeline.snapshots.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (timeline.snapshots[mid].time <= time) low = mid;
    else high = mid - 1;
  }
  return low;
}

export function nearestSourceTime(timeline: ReplayTimeline, sourceTime: number): number {
  if (!timeline.snapshots.length) return 0;
  let closest = timeline.snapshots[0];
  for (const snapshot of timeline.snapshots) {
    if (Math.abs(snapshot.sourceTime - sourceTime) < Math.abs(closest.sourceTime - sourceTime)) closest = snapshot;
  }
  return closest.time;
}

export function playerKey(player: Pick<ReplayCar, "name" | "team">): string {
  return `${player.team}:${player.name}`;
}

export function replayActorKey(car: Pick<ReplayCar, "id" | "name" | "team">): string {
  return `${car.id}:${playerKey(car)}`;
}

export function listReplayPlayers(timeline: ReplayTimeline): ReplayPlayer[] {
  const players = new Map<string, ReplayPlayer>();
  for (const frame of timeline.snapshots) {
    for (const car of frame.cars) {
      const key = playerKey(car);
      if (!players.has(key)) players.set(key, { key, name: car.name, team: car.team });
    }
  }
  return [...players.values()].sort((a, b) => a.team - b.team || a.name.localeCompare(b.name));
}

export function interpolateAngle(a: number, b: number, amount: number): number {
  const delta = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + delta * amount;
}

export function interpolateRotation(a: QuaternionData | null, b: QuaternionData | null, amount: number): QuaternionData | null {
  if (!a || !b) return a || b || null;
  let start = normalizeQuaternion(a);
  let end = normalizeQuaternion(b);
  let dot = start.x * end.x + start.y * end.y + start.z * end.z + start.w * end.w;
  if (dot < 0) {
    end = { x: -end.x, y: -end.y, z: -end.z, w: -end.w };
    dot = -dot;
  }
  if (dot > .9995) return normalizeQuaternion({
    x: start.x + (end.x - start.x) * amount,
    y: start.y + (end.y - start.y) * amount,
    z: start.z + (end.z - start.z) * amount,
    w: start.w + (end.w - start.w) * amount,
  });
  const theta = Math.acos(Math.max(-1, Math.min(1, dot)));
  const sinTheta = Math.sin(theta);
  const startWeight = Math.sin((1 - amount) * theta) / sinTheta;
  const endWeight = Math.sin(amount * theta) / sinTheta;
  return {
    x: start.x * startWeight + end.x * endWeight,
    y: start.y * startWeight + end.y * endWeight,
    z: start.z * startWeight + end.z * endWeight,
    w: start.w * startWeight + end.w * endWeight,
  };
}

export function replayStateAt(timeline: ReplayTimeline, requestedTime: number): InterpolatedReplayState {
  const time = clampTime(timeline, requestedTime);
  const index = findSnapshotIndex(timeline, time);
  if (index < 0) return EMPTY_STATE;
  const frame = timeline.snapshots[index];
  return {
    cars: frame.cars.map(car => interpolateCar(timeline, car, index, time)),
    ball: interpolateBall(timeline, frame.ball, index, time),
    frameIndex: frame.frameIndex,
  };
}

function interpolateCar(timeline: ReplayTimeline, car: ReplayCar, index: number, time: number): ReplayCar {
  let start = index;
  while (start > 0 && sameCarTransform(carAt(timeline.snapshots[start - 1], car.id), car)) start--;
  let end = index + 1;
  while (end < timeline.snapshots.length && sameCarTransform(carAt(timeline.snapshots[end], car.id), car)) end++;
  if (end >= timeline.snapshots.length || timeline.snapshots[end].time - timeline.snapshots[start].time > INTERPOLATION_GAP_SECONDS) return car;
  const next = carAt(timeline.snapshots[end], car.id);
  const span = timeline.snapshots[end].time - timeline.snapshots[start].time;
  if (!next || span <= 0) return car;
  const amount = Math.max(0, Math.min(1, (time - timeline.snapshots[start].time) / span));
  return {
    ...car,
    x: car.x + (next.x - car.x) * amount,
    y: car.y + (next.y - car.y) * amount,
    z: car.z + (next.z - car.z) * amount,
    yaw: interpolateAngle(car.yaw, next.yaw, amount),
    rotation: interpolateRotation(car.rotation, next.rotation, amount),
  };
}

function interpolateBall(timeline: ReplayTimeline, ball: Vector3Data | null, index: number, time: number): Vector3Data | null {
  if (!ball) return null;
  let start = index;
  while (start > 0 && samePosition(timeline.snapshots[start - 1].ball, ball)) start--;
  let end = index + 1;
  while (end < timeline.snapshots.length && samePosition(timeline.snapshots[end].ball, ball)) end++;
  const next = timeline.snapshots[end]?.ball;
  const span = (timeline.snapshots[end]?.time ?? 0) - timeline.snapshots[start].time;
  if (!next || span <= 0 || span > INTERPOLATION_GAP_SECONDS) return ball;
  const amount = Math.max(0, Math.min(1, (time - timeline.snapshots[start].time) / span));
  return {
    x: ball.x + (next.x - ball.x) * amount,
    y: ball.y + (next.y - ball.y) * amount,
    z: ball.z + (next.z - ball.z) * amount,
  };
}

function carAt(frame: ReplaySnapshot, id: number): ReplayCar | undefined {
  return frame.cars.find(car => car.id === id);
}

function sameCarTransform(a: ReplayCar | undefined, b: ReplayCar | undefined): boolean {
  if (!a || !b || a.x !== b.x || a.y !== b.y || a.z !== b.z) return false;
  if (!a.rotation || !b.rotation) return !a.rotation && !b.rotation && a.yaw === b.yaw;
  return a.rotation.x === b.rotation.x && a.rotation.y === b.rotation.y &&
    a.rotation.z === b.rotation.z && a.rotation.w === b.rotation.w;
}

function samePosition(a: Vector3Data | null, b: Vector3Data | null): boolean {
  return Boolean(a && b && a.x === b.x && a.y === b.y && a.z === b.z);
}

function normalizeQuaternion(value: QuaternionData): QuaternionData {
  const length = Math.hypot(value.x, value.y, value.z, value.w);
  return length === 0 ? { x: 0, y: 0, z: 0, w: 1 } : {
    x: value.x / length,
    y: value.y / length,
    z: value.z / length,
    w: value.w / length,
  };
}
