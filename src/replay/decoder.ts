import {
  actorReference,
  attributeValue,
  objectIds,
  rigidBody,
  RRROCKET_OBJECT_NAMES,
  stringAttribute,
} from "./rrrocket-adapter";
import type { QuaternionData, RawRrrocketReplay, ReplaySnapshot, Vector3Data } from "./types";

interface ActorState {
  id: number;
  type: string;
  location: Vector3Data | null;
  rotation: QuaternionData | null;
  priId: number | null;
}

export function quaternionYaw(q: QuaternionData | null): number {
  if (!q) return 0;
  return Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
}

export function buildSnapshots(data: RawRrrocketReplay): ReplaySnapshot[] {
  const ids = objectIds(data);
  const actors = new Map<number, ActorState>();
  const players = new Map<number, { name: string; teamActor: number | null }>();
  const teams = new Map<number, number>();
  const result: ReplaySnapshot[] = [];
  let secondsRemaining: number | null = null;
  let overtime = false;
  let overtimeElapsed = 0;
  let gameActive = false;
  let previousFrameTime = data.network_frames.frames[0]?.time ?? 0;

  data.network_frames.frames.forEach((frame, frameIndex) => {
    if (overtime && gameActive) overtimeElapsed += Math.max(0, frame.time - previousFrameTime);
    previousFrameTime = frame.time;

    for (const actor of frame.new_actors) {
      const type = data.objects[actor.object_id] || "";
      actors.set(actor.actor_id, {
        id: actor.actor_id,
        type,
        location: actor.initial_trajectory?.location ? { ...actor.initial_trajectory.location } : null,
        rotation: null,
        priId: null,
      });
      if (type === "TAGame.Default__PRI_TA" || type.endsWith(".Default__PRI_TA")) {
        players.set(actor.actor_id, { name: "Player", teamActor: null });
      }
      if (type === RRROCKET_OBJECT_NAMES.blueTeam) teams.set(actor.actor_id, 0);
      if (type === RRROCKET_OBJECT_NAMES.orangeTeam) teams.set(actor.actor_id, 1);
    }

    for (const update of frame.updated_actors) {
      const state = actors.get(update.actor_id);
      if (update.object_id === ids.get(RRROCKET_OBJECT_NAMES.rigidBody) && state) {
        const body = rigidBody(update.attribute);
        if (body) {
          state.location = body.location;
          state.rotation = body.rotation;
        }
      } else if (update.object_id === ids.get(RRROCKET_OBJECT_NAMES.playerReplication) && state) {
        state.priId = actorReference(update.attribute);
      } else if (update.object_id === ids.get(RRROCKET_OBJECT_NAMES.playerName)) {
        const player = players.get(update.actor_id);
        const name = stringAttribute(update.attribute);
        if (player && name !== null) player.name = name;
      } else if (update.object_id === ids.get(RRROCKET_OBJECT_NAMES.playerTeam)) {
        const player = players.get(update.actor_id);
        if (player) player.teamActor = actorReference(update.attribute);
      } else if (update.object_id === ids.get(RRROCKET_OBJECT_NAMES.secondsRemaining)) {
        const value = Number(attributeValue(update.attribute));
        if (Number.isFinite(value)) secondsRemaining = value;
      } else if (update.object_id === ids.get(RRROCKET_OBJECT_NAMES.overtime)) {
        const next = Boolean(attributeValue(update.attribute));
        if (next && !overtime) overtimeElapsed = 0;
        overtime = next;
      } else if (update.object_id === ids.get(RRROCKET_OBJECT_NAMES.gameState)) {
        gameActive = data.names[Number(attributeValue(update.attribute))] === "Active";
      }
    }

    for (const actorId of frame.deleted_actors) {
      actors.delete(actorId);
      players.delete(actorId);
      teams.delete(actorId);
    }

    const cars = [];
    let ball: Vector3Data | null = null;
    for (const actor of actors.values()) {
      if (!actor.location) continue;
      if (actor.type === RRROCKET_OBJECT_NAMES.ball) {
        ball = { ...actor.location };
      } else if (actor.type === RRROCKET_OBJECT_NAMES.car) {
        const player = players.get(actor.priId ?? -1);
        if (!player) continue;
        cars.push({
          id: actor.id,
          name: player.name,
          team: teams.get(player.teamActor ?? -1) ?? 0,
          ...actor.location,
          yaw: quaternionYaw(actor.rotation),
          rotation: actor.rotation ? { ...actor.rotation } : null,
        });
      }
    }

    result.push({
      time: frame.time,
      sourceTime: frame.time,
      frameIndex,
      cars,
      ball,
      secondsRemaining,
      overtime,
      overtimeElapsed,
    });
  });
  return result;
}
