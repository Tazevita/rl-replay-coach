import type { InterpolatedReplayState, ReplayPlayer } from "../../replay/types";
import type { PlayerPrediction } from "../../shared/contracts/replay-analysis-v2";
import { PREDICTION_HORIZONS, type PredictionHorizon } from "../../replay/predictions";
import { BALL_TRACKING_KEY } from "../../application/controllers/replay-viewer-controller";
import { InfoCard } from "./InfoCard";

interface PlayerSidebarProps {
  state: InterpolatedReplayState;
  players: readonly ReplayPlayer[];
  trackedPlayerKey: string | null;
  onTrackPlayer(key: string | null): void;
  predictionPlayers: readonly PlayerPrediction[];
  projectedCarsEnabled: boolean;
  projectedHorizon: PredictionHorizon;
  selectedProjectedPlayerIds: readonly string[];
  onProjectedCarsEnabled(enabled: boolean): void;
  onProjectedHorizon(horizon: PredictionHorizon): void;
  onProjectedPlayers(playerIds: readonly string[]): void;
  showProjections?: boolean;
}

export function PlayerSidebar(props: PlayerSidebarProps) {
  const cars = [...props.state.cars].sort((left, right) => left.team - right.team || left.name.localeCompare(right.name));
  return <aside className="sidebar">
    <section className="card">
      <div className="card-heading">
        <h2>View Controls</h2>
      </div>
      <PlayerTracker players={props.players} ballAvailable={Boolean(props.state.ball)} selected={props.trackedPlayerKey} onChange={props.onTrackPlayer} />
      {props.showProjections !== false && <ProjectedCarSettings
        players={props.predictionPlayers}
        enabled={props.projectedCarsEnabled}
        horizon={props.projectedHorizon}
        selectedPlayerIds={props.selectedProjectedPlayerIds}
        onEnabled={props.onProjectedCarsEnabled}
        onHorizon={props.onProjectedHorizon}
        onPlayers={props.onProjectedPlayers}
      />}
      <div className="players">
        {cars.length ? cars.map(car => <div className="player" key={car.id}>
          <span className="player-swatch" style={{ background: car.team === 0 ? "var(--blue)" : "var(--orange)" }} />
          <div><strong>{car.name}</strong><small>{car.team === 0 ? "Blue" : "Orange"} team</small></div>
          <span className="height">{(car.z / 100).toFixed(1)} m</span>
        </div>) : <p className="empty">Players are off-field.</p>}
      </div>
    </section>
  </aside>;
}

export function ProjectedCarSettings({
  players,
  enabled,
  horizon,
  selectedPlayerIds,
  onEnabled,
  onHorizon,
  onPlayers,
}: {
  players: readonly PlayerPrediction[];
  enabled: boolean;
  horizon: PredictionHorizon;
  selectedPlayerIds: readonly string[];
  onEnabled(enabled: boolean): void;
  onHorizon(horizon: PredictionHorizon): void;
  onPlayers(playerIds: readonly string[]): void;
}) {
  const selected = new Set(selectedPlayerIds);
  const togglePlayer = (id: string, checked: boolean): void => {
    onPlayers(checked ? [...selectedPlayerIds, id] : selectedPlayerIds.filter(playerId => playerId !== id));
  };
  return <fieldset className="projected-settings" disabled={!players.length}>
    <div className="control-with-info">
      <label className="projected-toggle">
        <input type="checkbox" checked={enabled} onChange={event => onEnabled(event.currentTarget.checked)} />
        <span>Show projected cars</span>
      </label>
      <InfoCard title="Show projected cars">Overlays each selected player's predicted position at the chosen timeframe so you can compare likely movement with what happens in the replay.</InfoCard>
    </div>
    <label className="projected-horizon">
      <span>Prediction timeframe</span>
      <select aria-label="Prediction timeframe" value={horizon} disabled={!enabled || !players.length} onChange={event => onHorizon(event.currentTarget.value as PredictionHorizon)}>
        {PREDICTION_HORIZONS.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}
      </select>
    </label>
    <div className="projected-player-list" aria-label="Projected car players">
      {players.map(player => <label key={player.id}>
        <input
          type="checkbox"
          checked={selected.has(player.id)}
          disabled={!enabled}
          onChange={event => togglePlayer(player.id, event.currentTarget.checked)}
        />
        <span className={player.team === "blue" ? "blue-text" : "orange-text"}>{player.displayName}</span>
      </label>)}
      {!players.length && <span className="projected-unavailable">Upload a replay to load predictions.</span>}
    </div>
  </fieldset>;
}

export function PlayerTracker({ players, ballAvailable = true, selected, onChange }: { players: readonly ReplayPlayer[]; ballAvailable?: boolean; selected: string | null; onChange(key: string | null): void }) {
  return <label className="player-tracker">
    <span>Autotrack</span>
    <select aria-label="Autotrack" value={selected ?? ""} disabled={!ballAvailable && !players.length} onChange={event => onChange(event.currentTarget.value || null)}>
      <option value="">Off</option>
      <option value={BALL_TRACKING_KEY} disabled={!ballAvailable}>Ball</option>
      {players.map(player => <option key={player.key} value={player.key}>{player.name} ({player.team === 0 ? "Blue" : "Orange"})</option>)}
    </select>
  </label>;
}
