import type { PlayerPredictions, ReplayAnalysisBundleV2, TeamAnalysis } from "../../shared/contracts/replay-analysis-v2";
import { buildSnapshots } from "../../replay/decoder";
import { deriveReplayMetadata } from "../../replay/metadata";
import {
  clampTime,
  createReplayTimeline,
  findSnapshotIndex,
  listReplayPlayers,
  nearestSourceSnapshot,
  nearestSourceTime,
  replayActorKey,
  replayStateAt,
  type ReplayTimeline,
} from "../../replay/timeline";
import type {
  InterpolatedReplayState,
  RawRrrocketReplay,
  ReplayCar,
  ReplayMetadata,
  ReplayPlayer,
  ReplaySnapshot,
} from "../../replay/types";
import { EMPTY_PLAYER_PREDICTIONS } from "../../replay/predictions";

export interface ReplayUpload {
  name: string;
  content: unknown;
}

export interface ReplayProcessingGateway {
  process(upload: ReplayUpload): Promise<ReplayAnalysisBundleV2>;
}

export interface ReplayDataGateway {
  load(url: string): Promise<RawRrrocketReplay>;
  loadBundle?(url: string): Promise<ReplayAnalysisBundleV2>;
}

export type ReplayView = "2d" | "3d" | "autocam";
export const BALL_TRACKING_KEY = "__ball__";

export interface ReplayViewerError {
  operation: "load" | "upload";
  message: string;
}

export interface ReplayViewerState {
  replayId: string | null;
  loading: boolean;
  processing: boolean;
  metadata: ReplayMetadata | null;
  analysis: readonly TeamAnalysis[];
  playerPredictions: PlayerPredictions;
  playing: boolean;
  playhead: number;
  speed: number;
  view: ReplayView;
  trackedPlayerKey: string | null;
  currentReplayState: InterpolatedReplayState;
  replayActors: readonly ReplayCar[];
  currentSnapshot: ReplaySnapshot | null;
  players: readonly ReplayPlayer[];
  timelineStart: number;
  timelineEnd: number;
  duration: number;
  cameraResetVersion: number;
  error: ReplayViewerError | null;
}

export interface ReplayViewerController {
  getSnapshot(): ReplayViewerState;
  subscribe(listener: () => void): () => void;
  loadInitialReplay(): Promise<void>;
  uploadReplay(upload: ReplayUpload): Promise<void>;
  play(): void;
  pause(): void;
  togglePlayback(): void;
  tick(elapsedSeconds: number): void;
  seek(timeSeconds: number): void;
  seekToSourceTime(sourceTimeSeconds: number): void;
  snapshotAtSourceTime(sourceTimeSeconds: number): ReplaySnapshot | undefined;
  skip(deltaSeconds: number): void;
  setSpeed(speed: number): void;
  setView(view: ReplayView): void;
  setTrackedPlayer(playerKey: string | null): void;
}

const EMPTY_REPLAY_STATE: InterpolatedReplayState = freezeValue({ cars: [], ball: null, frameIndex: 0 });
const PLAYBACK_NOTIFICATION_INTERVAL_SECONDS = 0.1;

export class DefaultReplayViewerController implements ReplayViewerController {
  private timeline: ReplayTimeline = createReplayTimeline([]);
  private readonly listeners = new Set<() => void>();
  private playbackNotificationElapsed = 0;
  private state: ReplayViewerState = Object.freeze({
    replayId: null,
    loading: false,
    processing: false,
    metadata: null,
    analysis: [],
    playerPredictions: EMPTY_PLAYER_PREDICTIONS,
    playing: false,
    playhead: 0,
    speed: 1,
    view: "2d",
    trackedPlayerKey: null,
    currentReplayState: EMPTY_REPLAY_STATE,
    replayActors: [],
    currentSnapshot: null,
    players: [],
    timelineStart: 0,
    timelineEnd: 0,
    duration: 0,
    cameraResetVersion: 0,
    error: null,
  });

  constructor(
    private readonly processingGateway: ReplayProcessingGateway,
    private readonly replayGateway: ReplayDataGateway,
    private readonly initialReplayUrl?: string,
    private readonly initialBundleUrl?: string,
    private readonly initialSourceTime?: number,
  ) {}

  getSnapshot = (): ReplayViewerState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async loadInitialReplay(): Promise<void> {
    if (!this.initialReplayUrl) return;
    this.update({ loading: true, playing: false, error: null });
    try {
      if (this.initialBundleUrl && !this.replayGateway.loadBundle) throw new Error("Replay analysis could not be loaded.");
      const bundle = this.initialBundleUrl ? await this.replayGateway.loadBundle?.(this.initialBundleUrl) : undefined;
      const replay = await this.replayGateway.load(bundle?.replay.dataUrl ?? this.initialReplayUrl);
      this.installReplay(replay, bundle?.analysis.teams ?? [], bundle?.analysis.playerPredictions ?? EMPTY_PLAYER_PREDICTIONS, bundle?.replay.id ?? null);
      if (this.initialSourceTime !== undefined) this.seekToSourceTime(this.initialSourceTime);
    } catch (error) {
      this.update({ loading: false, error: { operation: "load", message: errorMessage(error, "Replay could not be loaded.") } });
    }
  }

  async uploadReplay(upload: ReplayUpload): Promise<void> {
    if (!upload.name.toLowerCase().endsWith(".replay")) {
      const error = new Error("Choose a .replay file.");
      this.update({ error: { operation: "upload", message: error.message } });
      throw error;
    }
    this.update({ processing: true, playing: false, error: null });
    try {
      const result = await this.processingGateway.process(upload);
      const replay = await this.replayGateway.load(result.replay.dataUrl);
      this.installReplay(replay, result.analysis.teams, result.analysis.playerPredictions, result.replay.id);
    } catch (error) {
      this.update({
        loading: false,
        processing: false,
        error: { operation: "upload", message: errorMessage(error, "Replay processing failed.") },
      });
      throw error;
    }
  }

  play(): void {
    if (!this.timeline.snapshots.length) return;
    const playhead = this.state.playhead >= this.timeline.endTime ? this.timeline.startTime : this.state.playhead;
    this.setPlayhead(playhead, true, true, playhead !== this.state.playhead);
  }

  pause(): void {
    if (this.state.playing) this.update({ playing: false });
  }

  togglePlayback(): void {
    if (this.state.playing) this.pause();
    else this.play();
  }

  tick(elapsedSeconds: number): void {
    if (!this.state.playing || !Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return;
    const next = this.state.playhead + elapsedSeconds * this.state.speed;
    const playing = next < this.timeline.endTime;
    this.playbackNotificationElapsed += elapsedSeconds;
    const notify = !playing || this.playbackNotificationElapsed >= PLAYBACK_NOTIFICATION_INTERVAL_SECONDS;
    this.setPlayhead(next, playing, notify);
  }

  seek(timeSeconds: number): void {
    if (!this.timeline.snapshots.length) return;
    this.setPlayhead(timeSeconds, this.state.playing && timeSeconds < this.timeline.endTime, true, true);
  }

  seekToSourceTime(sourceTimeSeconds: number): void {
    if (!this.timeline.snapshots.length) return;
    this.seek(nearestSourceTime(this.timeline, sourceTimeSeconds));
  }

  snapshotAtSourceTime(sourceTimeSeconds: number): ReplaySnapshot | undefined {
    return nearestSourceSnapshot(this.timeline, sourceTimeSeconds);
  }

  skip(deltaSeconds: number): void {
    if (Number.isFinite(deltaSeconds)) this.seek(this.state.playhead + deltaSeconds);
  }

  setSpeed(speed: number): void {
    if (Number.isFinite(speed) && speed > 0 && speed !== this.state.speed) this.update({ speed });
  }

  setView(view: ReplayView): void {
    if (view === this.state.view && this.state.trackedPlayerKey === null) return;
    this.update({
      view,
      trackedPlayerKey: null,
      cameraResetVersion: view === "autocam" ? this.state.cameraResetVersion + 1 : this.state.cameraResetVersion,
    });
  }

  setTrackedPlayer(playerKey: string | null): void {
    const selected = playerKey === BALL_TRACKING_KEY || (playerKey && this.state.players.some(player => player.key === playerKey)) ? playerKey : null;
    if (selected === this.state.trackedPlayerKey && (!selected || this.state.view === "autocam")) return;
    this.update({
      trackedPlayerKey: selected,
      view: selected ? "autocam" : this.state.view === "autocam" ? "3d" : this.state.view,
      cameraResetVersion: selected ? this.state.cameraResetVersion + 1 : this.state.cameraResetVersion,
    });
  }

  private installReplay(
    replay: RawRrrocketReplay,
    analysis: readonly TeamAnalysis[],
    playerPredictions: PlayerPredictions,
    replayId: string | null,
  ): void {
    const snapshots = buildSnapshots(replay);
    if (!snapshots.length) throw new Error("The replay contains no network frames.");
    this.timeline = createReplayTimeline(snapshots);
    const playhead = this.timeline.startTime;
    this.state = Object.freeze({
      ...this.state,
      replayId,
      loading: false,
      processing: false,
      metadata: freezeValue(deriveReplayMetadata(replay, snapshots)),
      analysis: freezeValue([...analysis]),
      playerPredictions: freezeValue(playerPredictions),
      playing: false,
      playhead,
      currentReplayState: freezeValue(replayStateAt(this.timeline, playhead)),
      replayActors: freezeValue(listReplayActors(this.timeline)),
      currentSnapshot: freezeValue(snapshots[0]),
      players: freezeValue(listReplayPlayers(this.timeline)),
      timelineStart: this.timeline.startTime,
      timelineEnd: this.timeline.endTime,
      duration: this.timeline.duration,
      cameraResetVersion: this.state.cameraResetVersion + 1,
      trackedPlayerKey: null,
      error: null,
    });
    this.emit();
  }

  private setPlayhead(requestedTime: number, playing: boolean, notify = true, resetCamera = false): void {
    const playhead = clampTime(this.timeline, requestedTime);
    const snapshotIndex = findSnapshotIndex(this.timeline, playhead);
    if (notify) this.playbackNotificationElapsed = 0;
    this.update({
      playhead,
      playing,
      currentReplayState: freezeValue(replayStateAt(this.timeline, playhead)),
      currentSnapshot: snapshotIndex < 0 ? null : freezeValue(this.timeline.snapshots[snapshotIndex]),
      cameraResetVersion: resetCamera ? this.state.cameraResetVersion + 1 : this.state.cameraResetVersion,
    }, notify);
  }

  private update(changes: Partial<ReplayViewerState>, notify = true): void {
    this.state = Object.freeze({ ...this.state, ...changes });
    if (notify) this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

function listReplayActors(timeline: ReplayTimeline): ReplayCar[] {
  const actors = new Map<string, ReplayCar>();
  for (const snapshot of timeline.snapshots) {
    for (const car of snapshot.cars) {
      const key = replayActorKey(car);
      if (!actors.has(key)) actors.set(key, car);
    }
  }
  return [...actors.values()];
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function freezeValue<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freezeValue(nested);
  return Object.freeze(value);
}
