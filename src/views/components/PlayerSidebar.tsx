import { formatTime } from "../../replay/metadata";
import type { InterpolatedReplayState, ReplayGoal, ReplayPlayer } from "../../replay/types";
import type { PlayerPrediction } from "../../shared/contracts/replay-analysis-v2";
import { PREDICTION_HORIZONS, type PredictionHorizon } from "../../replay/predictions";

interface PlayerSidebarProps {
  state: InterpolatedReplayState;
  players: readonly ReplayPlayer[];
  trackedPlayerKey: string | null;
  goals: readonly ReplayGoal[];
  onTrackPlayer(key: string | null): void;
  onGoal(goalTime: number): void;
  predictionPlayers: readonly PlayerPrediction[];
  ghostCarsEnabled: boolean;
  ghostHorizon: PredictionHorizon;
  selectedGhostPlayerIds: readonly string[];
  onGhostCarsEnabled(enabled: boolean): void;
  onGhostHorizon(horizon: PredictionHorizon): void;
  onGhostPlayers(playerIds: readonly string[]): void;
}

export function PlayerSidebar(props: PlayerSidebarProps) {
  const cars = [...props.state.cars].sort((left, right) => left.team - right.team || left.name.localeCompare(right.name));
  return <aside className="sidebar">
    <section className="card">
      <div className="card-heading">
        <h2>Players</h2>
        <span className="live-dot">LIVE POSITIONS</span>
      </div>
      <PlayerTracker players={props.players} selected={props.trackedPlayerKey} onChange={props.onTrackPlayer} />
      <GhostCarSettings
        players={props.predictionPlayers}
        enabled={props.ghostCarsEnabled}
        horizon={props.ghostHorizon}
        selectedPlayerIds={props.selectedGhostPlayerIds}
        onEnabled={props.onGhostCarsEnabled}
        onHorizon={props.onGhostHorizon}
        onPlayers={props.onGhostPlayers}
      />
      <div className="players">
        {cars.length ? cars.map(car => <div className="player" key={car.id}>
          <span className="player-swatch" style={{ background: car.team === 0 ? "#2864dc" : "#e96f2d" }} />
          <div><strong>{car.name}</strong><small>{car.team === 0 ? "Blue" : "Orange"} team</small></div>
          <span className="height">{(car.z / 100).toFixed(1)} m</span>
        </div>) : <p className="empty">Players are off-field.</p>}
      </div>
    </section>
    <GoalList goals={props.goals} onGoal={props.onGoal} />
  </aside>;
}

export function GhostCarSettings({
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
  return <fieldset className="ghost-settings" disabled={!players.length}>
    <label className="ghost-toggle">
      <input type="checkbox" checked={enabled} onChange={event => onEnabled(event.currentTarget.checked)} />
      <span>Enable ghost cars</span>
    </label>
    <label className="ghost-horizon">
      <span>Prediction timeframe</span>
      <select aria-label="Prediction timeframe" value={horizon} disabled={!enabled || !players.length} onChange={event => onHorizon(event.currentTarget.value as PredictionHorizon)}>
        {PREDICTION_HORIZONS.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}
      </select>
    </label>
    <div className="ghost-player-list" aria-label="Ghost car players">
      {players.map(player => <label key={player.id}>
        <input
          type="checkbox"
          checked={selected.has(player.id)}
          disabled={!enabled}
          onChange={event => togglePlayer(player.id, event.currentTarget.checked)}
        />
        <span className={player.team === "blue" ? "blue-text" : "orange-text"}>{player.displayName}</span>
      </label>)}
      {!players.length && <span className="ghost-unavailable">Upload a replay to load predictions.</span>}
    </div>
  </fieldset>;
}

export function PlayerTracker({ players, selected, onChange }: { players: readonly ReplayPlayer[]; selected: string | null; onChange(key: string | null): void }) {
  return <label className="player-tracker">
    <span>Auto track player</span>
    <select aria-label="Auto track player" value={selected ?? ""} disabled={!players.length} onChange={event => onChange(event.currentTarget.value || null)}>
      <option value="">Select a player</option>
      {players.map(player => <option key={player.key} value={player.key}>{player.name} ({player.team === 0 ? "Blue" : "Orange"})</option>)}
    </select>
  </label>;
}

export function GoalList({ goals, onGoal }: { goals: readonly ReplayGoal[]; onGoal(time: number): void }) {
  return <section className="card event-card">
    <h2>Goals</h2>
    <div className="events">{goals.length ? goals.map(goal => <button className="event" type="button" key={`${goal.frame}:${goal.time}`} onClick={() => onGoal(goal.time)}>
      <span className="event-time">{formatTime(goal.elapsed, false)}</span>
      <span className="event-dot" style={{ background: goal.playerTeam === 0 ? "#2864dc" : "#e96f2d" }} />
      <strong>{goal.playerName}</strong>
    </button>) : <p className="empty">No goals in this replay.</p>}</div>
  </section>;
}
