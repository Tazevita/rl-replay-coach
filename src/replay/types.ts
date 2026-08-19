export interface Vector3Data {
  x: number;
  y: number;
  z: number;
}

export interface QuaternionData extends Vector3Data {
  w: number;
}

export interface ReplayCar extends Vector3Data {
  id: number;
  name: string;
  team: number;
  yaw: number;
  rotation: QuaternionData | null;
}

export interface ReplaySnapshot {
  time: number;
  sourceTime: number;
  frameIndex: number;
  cars: ReplayCar[];
  ball: Vector3Data | null;
  secondsRemaining: number | null;
  overtime: boolean;
  overtimeElapsed: number;
}

export interface InterpolatedReplayState {
  cars: ReplayCar[];
  ball: Vector3Data | null;
  frameIndex: number;
}

export interface ReplayPlayer {
  key: string;
  name: string;
  team: number;
}

export interface GhostCar extends Vector3Data {
  id: string;
  name: string;
  team: number;
  yaw: number;
}

export interface RawNewActor {
  actor_id: number;
  object_id: number;
  initial_trajectory?: { location?: Vector3Data } | null;
}

export interface RawUpdatedActor {
  actor_id: number;
  object_id: number;
  attribute: unknown;
}

export interface RawReplayFrame {
  time: number;
  new_actors: RawNewActor[];
  updated_actors: RawUpdatedActor[];
  deleted_actors: number[];
}

export interface RawReplayGoal {
  frame: number;
  PlayerName?: string;
  PlayerTeam?: number;
}

export interface RawRrrocketReplay {
  properties: Record<string, unknown>;
  objects: string[];
  names: string[];
  network_frames: { frames: RawReplayFrame[] };
}

export interface ReplayGoal {
  frame: number;
  time: number;
  elapsed: number;
  playerName: string;
  playerTeam: number;
}

export interface ReplayMetadata {
  mapName: string;
  matchType: string;
  blueScore: number;
  orangeScore: number;
  duration: number;
  goals: ReplayGoal[];
}
