import type { RawReplayGoal, RawRrrocketReplay, ReplayMetadata, ReplaySnapshot } from "./types";

export function deriveReplayMetadata(replay: RawRrrocketReplay, snapshots: readonly ReplaySnapshot[]): ReplayMetadata {
  const properties = replay.properties;
  const start = snapshots[0]?.time ?? 0;
  const end = snapshots.at(-1)?.time ?? start;
  const goals = Array.isArray(properties.Goals) ? properties.Goals as RawReplayGoal[] : [];
  return {
    mapName: text(properties.MapName, "Rocket League"),
    matchType: text(properties.MatchType, "Replay"),
    blueScore: score(properties.Team0Score),
    orangeScore: score(properties.Team1Score),
    duration: Math.max(0, end - start),
    goals: goals.map(goal => {
      const frame = snapshots[Math.max(0, Math.min(snapshots.length - 1, Number(goal.frame) || 0))];
      const time = frame?.time ?? start;
      return {
        frame: Number(goal.frame) || 0,
        time,
        elapsed: Math.max(0, time - start),
        playerName: text(goal.PlayerName, "Player"),
        playerTeam: score(goal.PlayerTeam),
      };
    }),
  };
}

export function formatTime(seconds: number, tenths = true): string {
  const safe = Math.max(0, seconds || 0);
  const minutes = Math.floor(safe / 60);
  const remainder = safe - minutes * 60;
  return `${minutes}:${remainder.toFixed(tenths ? 1 : 0).padStart(tenths ? 4 : 2, "0")}`;
}

export function formatGameClock(snapshot: ReplaySnapshot | undefined): string {
  if (!snapshot) return "--:--";
  if (snapshot.overtime) return `OT +${formatTime(Math.floor(snapshot.overtimeElapsed), false)}`;
  return snapshot.secondsRemaining === null ? "--:--" : formatTime(snapshot.secondsRemaining, false);
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value ? value : fallback;
}

function score(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
