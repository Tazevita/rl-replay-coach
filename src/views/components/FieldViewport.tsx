import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { ReplayView, ReplayViewerController } from "../../application/controllers/replay-viewer-controller";
import type { ReplayCar, ReplayPlayer } from "../../replay/types";
import { ghostCarsAt, type PredictionHorizon } from "../../replay/predictions";
import type { PlayerPredictions } from "../../shared/contracts/replay-analysis-v2";
import { CanvasReplayRenderer } from "../../adapters/rendering/canvas2d/canvas-replay-renderer";
import { ReplayRenderRuntime } from "../../adapters/rendering/replay-render-runtime";
import type { ReplayRenderer } from "../../adapters/rendering/types";

const ThreeReplayViewport = lazy(async () => {
  const module = await import("./ThreeReplayViewport");
  return { default: module.ThreeReplayViewport };
});

interface FieldViewportProps {
  controller: ReplayViewerController;
  view: ReplayView;
  trackedPlayerKey: string | null;
  players: readonly ReplayPlayer[];
  replayActors: readonly ReplayCar[];
  ghostPredictions: PlayerPredictions;
  ghostCarsEnabled: boolean;
  ghostHorizon: PredictionHorizon;
  selectedGhostPlayerIds: ReadonlySet<string>;
}

export function FieldViewport({ controller, view, trackedPlayerKey, players, replayActors, ghostPredictions, ghostCarsEnabled, ghostHorizon, selectedGhostPlayerIds }: FieldViewportProps) {
  const renderSurface = useRef<HTMLDivElement>(null);
  const latestGhostSettings = useRef({ ghostPredictions, ghostCarsEnabled, ghostHorizon, selectedGhostPlayerIds });
  latestGhostSettings.current = { ghostPredictions, ghostCarsEnabled, ghostHorizon, selectedGhostPlayerIds };
  const [rendererError, setRendererError] = useState<string | null>(null);
  useEffect(() => {
    setRendererError(null);
    if (view !== "2d") return;
    const container = renderSurface.current;
    if (!container) return;
    let cancelled = false;
    let runtime: ReplayRenderRuntime | null = null;
    const setup = async (): Promise<void> => {
      try {
        const createRenderer: (canvas: HTMLCanvasElement) => ReplayRenderer = canvas => new CanvasReplayRenderer(canvas);
        runtime = new ReplayRenderRuntime(container, {
          canvasLabel: "Overhead Rocket League field replay",
          createRenderer,
            getFrame: deltaSeconds => {
              controller.tick(deltaSeconds);
              const state = controller.getSnapshot();
              const ghosts = latestGhostSettings.current;
              return {
                state: state.currentReplayState,
              context: {
                deltaSeconds,
                autoCamera: false,
                trackedPlayerKey: state.trackedPlayerKey,
                  ghostCars: ghosts.ghostCarsEnabled
                    ? ghostCarsAt(ghosts.ghostPredictions, state.playhead, ghosts.ghostHorizon, ghosts.selectedGhostPlayerIds)
                    : [],
              },
            };
          },
          onError: error => setRendererError(error instanceof Error ? error.message : "Replay rendering is unavailable."),
        });
        if (cancelled) runtime.dispose();
        else runtime.start();
      } catch (error) {
        if (!cancelled) setRendererError(error instanceof Error ? error.message : "Replay rendering is unavailable.");
      }
    };
    void setup();
    return () => {
      cancelled = true;
      runtime?.dispose();
    };
  }, [controller, view]);
  const tracked = trackedPlayerKey ? players.find(player => player.key === trackedPlayerKey) : null;
  const hint = tracked
    ? `AUTO CAM · Tracking ${tracked.name} · Drag to rotate · Scroll to zoom`
    : view === "autocam" ? "AUTO CAM · Tracking the play · Drag to rotate · Scroll to zoom" : "Drag to orbit · Scroll to zoom · Right-drag to pan";
  return <>
    <div ref={renderSurface} className={`render-surface${view === "2d" ? "" : " hidden"}`} />
    <Suspense fallback={null}>
      <ThreeReplayViewport
        controller={controller}
        active={view !== "2d"}
        replayActors={replayActors}
        autoCamera={view === "autocam"}
        trackedPlayerKey={trackedPlayerKey}
        ghostPredictions={ghostPredictions}
        ghostCarsEnabled={ghostCarsEnabled}
        ghostHorizon={ghostHorizon}
        selectedGhostPlayerIds={selectedGhostPlayerIds}
      />
    </Suspense>
    {view !== "2d" && <div className="camera-hint">{hint}</div>}
    {rendererError && <div className="renderer-error" role="alert">{rendererError}</div>}
  </>;
}
