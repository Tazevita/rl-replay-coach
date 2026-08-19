import type { QuaternionData, RawRrrocketReplay, Vector3Data } from "./types";

// Exact names from rrrocket's current Rocket League object table are isolated here.
export const RRROCKET_OBJECT_NAMES = {
  rigidBody: "TAGame.RBActor_TA:ReplicatedRBState",
  playerReplication: "Engine.Pawn:PlayerReplicationInfo",
  playerName: "Engine.PlayerReplicationInfo:PlayerName",
  playerTeam: "Engine.PlayerReplicationInfo:Team",
  secondsRemaining: "TAGame.GameEvent_Soccar_TA:SecondsRemaining",
  overtime: "TAGame.GameEvent_Soccar_TA:bOverTime",
  gameState: "TAGame.GameEvent_TA:ReplicatedStateName",
  ball: "Archetypes.Ball.Ball_Default",
  car: "Archetypes.Car.Car_Default",
  blueTeam: "Archetypes.Teams.Team0",
  orangeTeam: "Archetypes.Teams.Team1",
} as const;

export function objectIds(replay: RawRrrocketReplay): Map<string, number> {
  return new Map(replay.objects.map((name, id) => [name, id]));
}

export function parseRrrocketReplay(value: unknown): RawRrrocketReplay {
  const replay = record(value);
  const networkFrames = record(replay.network_frames);
  if (!replay.properties || typeof replay.properties !== "object" || Array.isArray(replay.properties) ||
      !isStringArray(replay.objects) || !isStringArray(replay.names) || !Array.isArray(networkFrames.frames)) {
    throw new Error("The replay data does not match the expected rrrocket structure.");
  }
  for (const frameValue of networkFrames.frames) {
    const frame = record(frameValue);
    if (typeof frame.time !== "number" || !Number.isFinite(frame.time) ||
        !Array.isArray(frame.new_actors) || !Array.isArray(frame.updated_actors) || !Array.isArray(frame.deleted_actors)) {
      throw new Error("The replay contains an invalid rrrocket network frame.");
    }
  }
  return value as RawRrrocketReplay;
}

export function actorReference(attribute: unknown): number | null {
  const activeActor = record(record(attribute).ActiveActor);
  return activeActor.active ? number(activeActor.actor) : null;
}

export function attributeValue(attribute: unknown): unknown {
  if (!attribute || typeof attribute !== "object") return attribute;
  return Object.values(attribute)[0];
}

export function rigidBody(attribute: unknown): { location: Vector3Data; rotation: QuaternionData | null } | null {
  const value = record(record(attribute).RigidBody);
  const location = vector(value.location);
  if (!location) return null;
  return { location, rotation: quaternion(value.rotation) };
}

export function stringAttribute(attribute: unknown): string | null {
  const value = record(attribute).String;
  return typeof value === "string" ? value : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function vector(value: unknown): Vector3Data | null {
  const candidate = record(value);
  const x = number(candidate.x);
  const y = number(candidate.y);
  const z = number(candidate.z);
  return x === null || y === null || z === null ? null : { x, y, z };
}

function quaternion(value: unknown): QuaternionData | null {
  const candidate = vector(value);
  const w = number(record(value).w);
  return !candidate || w === null ? null : { ...candidate, w };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === "string");
}
