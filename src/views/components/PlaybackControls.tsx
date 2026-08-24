import type { ReplayGoal } from "../../replay/types";

interface PlaybackControlsProps {
  available: boolean;
  playing: boolean;
  playhead: number;
  timelineStart: number;
  duration: number;
  clock: string;
  endClock: string;
  speed: number;
  goals: readonly ReplayGoal[];
  onToggle(): void;
  onSeek(time: number): void;
  onSpeed(speed: number): void;
}

export function PlaybackControls(props: PlaybackControlsProps) {
  const position = props.duration > 0 ? (props.playhead - props.timelineStart) / props.duration * 1000 : 0;
  return <div className="timeline-panel">
    <div className="timeline-row">
      <button className="play-button" type="button" aria-label={props.playing ? "Pause replay" : "Play replay"} disabled={!props.available} onClick={props.onToggle}>
        <span>{props.playing ? "❚❚" : "▶"}</span>
      </button>
      <span className="time">{props.clock}</span>
      <div className="scrubber-wrap">
        <div className="goal-markers">{props.goals.map(goal => <span key={`${goal.frame}:${goal.time}`} className="goal-marker" style={{ left: `${props.duration > 0 ? goal.elapsed / props.duration * 100 : 0}%` }} />)}</div>
        <input type="range" min="0" max="1000" value={position} step="1" aria-label="Replay position" disabled={!props.available} onChange={event => props.onSeek(props.timelineStart + Number(event.currentTarget.value) / 1000 * props.duration)} />
      </div>
      <span className="time muted">{props.endClock}</span>
      <select aria-label="Playback speed" value={props.speed} onChange={event => props.onSpeed(Number(event.currentTarget.value))}>
        {[0.5, 1, 2, 4].map(speed => <option key={speed} value={speed}>{speed}×</option>)}
      </select>
    </div>
    <div className="hint"><kbd>Space</kbd> play/pause <span>•</span> <kbd>←</kbd><kbd>→</kbd> skip 5 seconds</div>
  </div>;
}
