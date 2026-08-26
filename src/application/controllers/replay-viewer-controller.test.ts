import { describe, expect, it, vi } from "vitest";
import { validBundle } from "../../test/fixtures";
import type { RawRrrocketReplay } from "../../replay/types";
import { RRROCKET_OBJECT_NAMES } from "../../replay/rrrocket-adapter";
import {
  BALL_TRACKING_KEY,
  DefaultReplayViewerController,
  type ReplayDataGateway,
  type ReplayProcessingGateway,
} from "./replay-viewer-controller";

function replay(times = [10, 12]): RawRrrocketReplay {
  return {
    properties: { MapName: "DFH" },
    objects: [],
    names: [],
    network_frames: {
      frames: times.map(time => ({ time, new_actors: [], updated_actors: [], deleted_actors: [] })),
    },
  };
}

function setup(data: ReplayDataGateway = { load: vi.fn(async () => replay()), loadBundle: vi.fn(async () => validBundle()) }, processing?: ReplayProcessingGateway) {
  const gateway = processing ?? { process: vi.fn(async () => validBundle()) };
  return {
    controller: new DefaultReplayViewerController(gateway, data, "/initial.json"),
    data,
    gateway,
  };
}

describe("DefaultReplayViewerController loading", () => {
  it("starts empty when no initial replay is requested", async () => {
    const data: ReplayDataGateway = { load: vi.fn() };
    const controller = new DefaultReplayViewerController({ process: vi.fn() }, data);

    await controller.loadInitialReplay();

    expect(data.load).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({ loading: false, metadata: null, error: null });
  });

  it("loads the initial replay and publishes immutable new snapshots", async () => {
    const { controller, data } = setup();
    const initial = controller.getSnapshot();
    const identities = [initial];
    controller.subscribe(() => identities.push(controller.getSnapshot()));

    await controller.loadInitialReplay();

    expect(data.load).toHaveBeenCalledWith("/initial.json");
    expect(controller.getSnapshot()).toMatchObject({ loading: false, playhead: 10, duration: 2, timelineEnd: 12, error: null });
    expect(controller.getSnapshot().metadata).toMatchObject({ mapName: "DFH" });
    expect(identities).toHaveLength(3);
    expect(new Set(identities).size).toBe(3);
    expect(Object.isFrozen(controller.getSnapshot())).toBe(true);
    expect(Object.isFrozen(controller.getSnapshot().currentReplayState.cars)).toBe(true);
  });

  it("restores a saved analysis bundle and seeks to a linked source timestamp", async () => {
    const bundle = validBundle();
    const data: ReplayDataGateway = {
      load: vi.fn(async () => replay([10, 11, 12])),
      loadBundle: vi.fn(async () => bundle),
    };
    const controller = new DefaultReplayViewerController(
      { process: vi.fn(async () => bundle) },
      data,
      "/api/replays/opaque-id/data",
      "/api/replays/opaque-id",
      11.6,
    );
    await controller.loadInitialReplay();
    expect(data.loadBundle).toHaveBeenCalledWith("/api/replays/opaque-id");
    expect(data.load).toHaveBeenCalledWith(bundle.replay.dataUrl);
    expect(controller.getSnapshot()).toMatchObject({ playhead: 12, loading: false, error: null });
    expect(controller.getSnapshot().analysis).toEqual(bundle.analysis.teams);
    expect(controller.getSnapshot().replayId).toBe(bundle.replay.id);
    expect(controller.getSnapshot().playerPredictions).toEqual(bundle.analysis.playerPredictions);
  });

  it("exposes initial loading failures without throwing", async () => {
    const { controller } = setup({ load: vi.fn(async () => { throw new Error("offline"); }) });
    await controller.loadInitialReplay();
    expect(controller.getSnapshot()).toMatchObject({ loading: false, error: { operation: "load", message: "offline" } });
  });

  it("reports an empty replay as a loading failure", async () => {
    const { controller } = setup({ load: vi.fn(async () => replay([])) });
    await controller.loadInitialReplay();
    expect(controller.getSnapshot().error?.message).toBe("The replay contains no network frames.");
  });

  it("processes uploads, loads their replay URL, and retains analysis", async () => {
    const { controller, data, gateway } = setup();
    await controller.uploadReplay({ name: "match.replay", content: "bytes" });
    expect(gateway.process).toHaveBeenCalledWith({ name: "match.replay", content: "bytes" });
    expect(data.load).toHaveBeenCalledWith("/api/replays/opaque-id/data");
    expect(controller.getSnapshot()).toMatchObject({ processing: false, error: null });
    expect(controller.getSnapshot().analysis).toHaveLength(1);
    expect(controller.getSnapshot().playerPredictions.players[0]).toMatchObject({ id: "player-1", displayName: "Alpha" });
  });

  it("exposes upload processing and replay-loading failures", async () => {
    const processingFailure = setup(undefined, { process: vi.fn(async () => { throw new Error("parse failed"); }) }).controller;
    await expect(processingFailure.uploadReplay({ name: "bad.replay", content: null })).rejects.toThrow("parse failed");
    expect(processingFailure.getSnapshot()).toMatchObject({ processing: false, error: { operation: "upload", message: "parse failed" } });

    const loadFailure = setup({ load: vi.fn(async () => { throw new Error("data missing"); }) }).controller;
    await expect(loadFailure.uploadReplay({ name: "bad.replay", content: null })).rejects.toThrow("data missing");
    expect(loadFailure.getSnapshot().error).toMatchObject({ operation: "upload", message: "data missing" });
  });
});

describe("DefaultReplayViewerController commands", () => {
  it("plays, pauses, toggles, applies speed, ticks, and stops at the end", async () => {
    const { controller } = setup();
    await controller.loadInitialReplay();
    controller.play();
    expect(controller.getSnapshot().playing).toBe(true);
    controller.setSpeed(2);
    controller.tick(.5);
    expect(controller.getSnapshot()).toMatchObject({ playhead: 11, playing: true, speed: 2 });
    controller.togglePlayback();
    expect(controller.getSnapshot().playing).toBe(false);
    controller.togglePlayback();
    controller.tick(2);
    expect(controller.getSnapshot()).toMatchObject({ playhead: 12, playing: false });
    controller.play();
    expect(controller.getSnapshot()).toMatchObject({ playhead: 10, playing: true });
    controller.pause();
    expect(controller.getSnapshot().playing).toBe(false);
  });

  it("advances every frame but throttles playback notifications", async () => {
    const { controller } = setup();
    await controller.loadInitialReplay();
    const listener = vi.fn();
    controller.subscribe(listener);
    controller.play();
    listener.mockClear();

    controller.tick(.04);
    controller.tick(.04);
    expect(controller.getSnapshot().playhead).toBeCloseTo(10.08);
    expect(listener).not.toHaveBeenCalled();

    controller.tick(.04);
    expect(controller.getSnapshot().playhead).toBeCloseTo(10.12);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("clamps seek and skip and seeks to nearest source time", async () => {
    const { controller } = setup({ load: vi.fn(async () => replay([10, 11, 12])) });
    await controller.loadInitialReplay();
    controller.seek(99);
    expect(controller.getSnapshot().playhead).toBe(12);
    controller.skip(-1.5);
    expect(controller.getSnapshot().playhead).toBe(10.5);
    controller.seekToSourceTime(11.6);
    expect(controller.getSnapshot().playhead).toBe(12);
    controller.skip(-99);
    expect(controller.getSnapshot().playhead).toBe(10);
  });

  it("requests an auto-camera reset for discontinuous playback changes", async () => {
    const { controller } = setup();
    await controller.loadInitialReplay();
    const initialVersion = controller.getSnapshot().cameraResetVersion;

    controller.play();
    controller.tick(.1);
    expect(controller.getSnapshot().cameraResetVersion).toBe(initialVersion);

    controller.seek(11);
    expect(controller.getSnapshot().cameraResetVersion).toBe(initialVersion + 1);
    controller.setView("autocam");
    expect(controller.getSnapshot().cameraResetVersion).toBe(initialVersion + 2);
  });

  it("transitions view and tracked-player intent", async () => {
    const raw: RawRrrocketReplay = {
      properties: {}, names: [],
      objects: [RRROCKET_OBJECT_NAMES.car, "TAGame.Default__PRI_TA", RRROCKET_OBJECT_NAMES.playerReplication],
      network_frames: { frames: [{
        time: 0,
        new_actors: [
          { actor_id: 1, object_id: 1 },
          { actor_id: 2, object_id: 0, initial_trajectory: { location: { x: 0, y: 0, z: 0 } } },
        ],
        updated_actors: [{ actor_id: 2, object_id: 2, attribute: { ActiveActor: { active: true, actor: 1 } } }],
        deleted_actors: [],
      }] },
    };
    const { controller } = setup({ load: vi.fn(async () => raw) });
    await controller.loadInitialReplay();
    controller.setView("3d");
    expect(controller.getSnapshot()).toMatchObject({ view: "3d", trackedPlayerKey: null });
    controller.setTrackedPlayer("0:Player");
    expect(controller.getSnapshot()).toMatchObject({ view: "autocam", trackedPlayerKey: "0:Player" });
    controller.setTrackedPlayer(BALL_TRACKING_KEY);
    expect(controller.getSnapshot()).toMatchObject({ view: "autocam", trackedPlayerKey: BALL_TRACKING_KEY });
    controller.setTrackedPlayer(null);
    expect(controller.getSnapshot()).toMatchObject({ view: "3d", trackedPlayerKey: null });
    controller.setView("2d");
    expect(controller.getSnapshot()).toMatchObject({ view: "2d", trackedPlayerKey: null });
  });

  it("notifies subscribers and honors unsubscribe", async () => {
    const { controller } = setup();
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);
    await controller.loadInitialReplay();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    controller.setSpeed(2);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
