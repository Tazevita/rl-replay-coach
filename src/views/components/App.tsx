import { useEffect, useMemo, useRef, useState } from "react";
import type { ReplayViewerController } from "../../application/controllers/replay-viewer-controller";
import { useReplayViewerController } from "../hooks/use-replay-viewer-controller";
import { useReplayKeyboard } from "../hooks/use-replay-keyboard";
import { AnalysisPanel, type AnalysisNavigationOptions } from "./AnalysisPanel";
import { FieldViewport } from "./FieldViewport";
import { LoadingOverlay } from "./LoadingOverlay";
import { PlaybackControls } from "./PlaybackControls";
import { PlayerSidebar } from "./PlayerSidebar";
import { ReplayToolbar, Scoreboard } from "./ReplayToolbar";
import type { PredictionHorizon } from "../../replay/predictions";
import { formatGameClock } from "../../replay/metadata";
import type { PlayerMistakesGateway } from "../../adapters/http/player-mistakes-gateway";

export function App({ controller, mistakesGateway, mode = "teams" }: { controller: ReplayViewerController; mistakesGateway: PlayerMistakesGateway; mode?: "teams" | "who-threw" }) {
  const whoThrew = mode === "who-threw";
  const state = useReplayViewerController(controller);
  const fieldPanel = useRef<HTMLDivElement>(null);
  const [projectedCarsEnabled, setProjectedCarsEnabled] = useState(false);
  const [projectedHorizon, setProjectedHorizon] = useState<PredictionHorizon>("0-1");
  const [selectedProjectedPlayerIds, setSelectedProjectedPlayerIds] = useState<readonly string[]>([]);
  const selectedProjectedPlayers = useMemo(() => new Set(selectedProjectedPlayerIds), [selectedProjectedPlayerIds]);
  const predictionPlayerKey = state.playerPredictions.players.map(player => player.id).join("\0");
  useEffect(() => {
    setSelectedProjectedPlayerIds(state.playerPredictions.players.map(player => player.id));
  }, [predictionPlayerKey]);
  useReplayKeyboard({
    enabled: Boolean(state.metadata),
    togglePlayback: () => controller.togglePlayback(),
    skip: seconds => controller.skip(seconds),
  });
  const navigateToSourceTime = (sourceTime: number, options?: AnalysisNavigationOptions): void => {
    controller.seekToSourceTime(sourceTime);
    if (options) {
      const { subject, teamId } = options;
      const normalizedName = subject.displayName.trim().toLocaleLowerCase();
      const prediction = state.playerPredictions.players.find(player =>
        (subject.playerId && player.id === subject.playerId)
        || (player.team === teamId && player.displayName.trim().toLocaleLowerCase() === normalizedName));
      const playerName = prediction?.displayName.trim().toLocaleLowerCase() ?? normalizedName;
      const team = teamId === "blue" ? 0 : 1;
      const replayPlayer = state.players.find(player =>
        (subject.playerId && player.key === subject.playerId)
        || (player.team === team && player.name.trim().toLocaleLowerCase() === playerName));
      if (options.autoProjection) {
        setProjectedCarsEnabled(true);
        if (prediction) setSelectedProjectedPlayerIds([prediction.id]);
        if (options.projectedHorizon) setProjectedHorizon(options.projectedHorizon);
      }
      if (options.autoCamera && replayPlayer) controller.setTrackedPlayer(replayPlayer.key);
    }
    const field = fieldPanel.current;
    if (field) {
      const top = field.getBoundingClientRect().top + window.scrollY - 24;
      window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    }
  };
  return <main className="app-shell">
    <ReplayToolbar
      metadata={state.metadata}
      view={state.view}
      processing={state.processing}
      whoThrew={whoThrew}
      onUpload={file => controller.uploadReplay({ name: file.name, content: file })}
      onViewChange={view => controller.setView(view)}
    />
    <section className="viewer-grid">
      <div className="field-panel" ref={fieldPanel}>
        <div className="canvas-wrap">
          <FieldViewport
            controller={controller}
            view={state.view}
            trackedPlayerKey={state.trackedPlayerKey}
            players={state.players}
            replayActors={state.replayActors}
            projectedPredictions={state.playerPredictions}
            projectedCarsEnabled={!whoThrew && projectedCarsEnabled}
            projectedHorizon={projectedHorizon}
            selectedProjectedPlayerIds={selectedProjectedPlayers}
          />
          <Scoreboard metadata={state.metadata} clock={formatGameClock(state.currentSnapshot ?? undefined)} overlay />
          <LoadingOverlay loading={state.loading} processing={state.processing} error={state.error} hasReplay={Boolean(state.metadata)} />
        </div>
        <PlaybackControls
          available={Boolean(state.metadata)}
          playing={state.playing}
          playhead={state.playhead}
          timelineStart={state.timelineStart}
          duration={state.duration}
          clock={formatGameClock(state.currentSnapshot ?? undefined)}
          endClock={formatGameClock(controller.snapshotAtSourceTime(state.timelineEnd))}
          speed={state.speed}
          goals={state.metadata?.goals ?? []}
          onToggle={() => controller.togglePlayback()}
          onSeek={time => controller.seek(time)}
          onSpeed={speed => controller.setSpeed(speed)}
        />
      </div>
      <PlayerSidebar
        state={state.currentReplayState}
        players={state.players}
        trackedPlayerKey={state.trackedPlayerKey}
        onTrackPlayer={key => controller.setTrackedPlayer(key)}
        predictionPlayers={state.playerPredictions.players}
        projectedCarsEnabled={projectedCarsEnabled}
        projectedHorizon={projectedHorizon}
        selectedProjectedPlayerIds={selectedProjectedPlayerIds}
        onProjectedCarsEnabled={setProjectedCarsEnabled}
        onProjectedHorizon={setProjectedHorizon}
        onProjectedPlayers={setSelectedProjectedPlayerIds}
        showProjections={!whoThrew}
      />
    </section>
    <AnalysisPanel
      teams={state.analysis}
      processing={state.processing}
      uploadError={state.error?.operation === "upload" ? state.error.message : null}
      mode={mode}
      replayId={state.replayId}
      mistakesGateway={mistakesGateway}
      clockAtSourceTime={sourceTime => {
        const clock = formatGameClock(controller.snapshotAtSourceTime(sourceTime));
        return clock === "--:--" ? undefined : clock;
      }}
      onNavigate={navigateToSourceTime}
    />
  </main>;
}
