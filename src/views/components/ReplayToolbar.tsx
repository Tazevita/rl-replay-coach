import type { ChangeEvent } from "react";
import type { ReplayMetadata } from "../../replay/types";
import type { ReplayView } from "../../application/controllers/replay-viewer-controller";

interface ReplayToolbarProps {
  metadata: ReplayMetadata | null;
  view: ReplayView;
  processing: boolean;
  whoThrew?: boolean;
  onUpload(file: File): Promise<void>;
  onViewChange(view: ReplayView): void;
}

export function ReplayToolbar(props: ReplayToolbarProps) {
  return <header className="topbar">
    <div>
      <p className="eyebrow">{props.whoThrew ? "Who threw?" : `${props.view === "2d" ? "2D" : "3D"} Match Replay`}</p>
      <h1>{props.metadata ? `${props.metadata.mapName} • ${props.metadata.matchType}` : props.processing ? "Adding replay..." : props.whoThrew ? "Add a replay to find the thrower" : "Add a replay"}</h1>
    </div>
    <div className="topbar-actions">
      <a className="check-player-link" href="/replay-history">Replay history</a>
      <a className="check-player-link" href="/check-player">Player Analysis</a>
      <a className="check-player-link" href="/guides#replay-review">How to use this</a>
      {!props.whoThrew && <a className="check-player-link" href="/who-threw">Who threw?</a>}
      {props.whoThrew && <a className="check-player-link" href="/">Full analysis</a>}
      <UploadControl processing={props.processing} onUpload={props.onUpload} />
      <ViewSelector view={props.view} onChange={props.onViewChange} autoLabel={props.whoThrew ? "Auto Ball" : "Auto Cam"} />
    </div>
  </header>;
}

export function UploadControl({ processing, onUpload }: Pick<ReplayToolbarProps, "processing" | "onUpload">) {
  const handleChange = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      await onUpload(file);
    } catch {
      // The controller exposes the actionable error in its store.
    } finally {
      input.value = "";
    }
  };
  return <form className={`upload-form${processing ? " busy" : ""}`} onSubmit={event => event.preventDefault()}>
    <label className="upload-button" htmlFor="replay-upload">Upload replay</label>
    <input id="replay-upload" type="file" accept=".replay" required disabled={processing} onChange={handleChange} />
  </form>;
}

export function ViewSelector({ view, onChange, autoLabel = "Auto Cam" }: { view: ReplayView; onChange: ReplayToolbarProps["onViewChange"]; autoLabel?: string }) {
  return <div className="view-toggle" aria-label="Replay view">
    {(["2d", "3d", "autocam"] as const).map(option => <button
      key={option}
      className={`view-option${option === "autocam" ? " autocam-option" : ""}${view === option ? " active" : ""}`}
      type="button"
      aria-pressed={view === option}
      onClick={() => onChange(option)}
    >{option === "autocam" ? autoLabel : option.toUpperCase()}</button>)}
  </div>;
}

export function Scoreboard({ metadata, clock, overlay = false }: { metadata: ReplayMetadata | null; clock: string; overlay?: boolean }) {
  return <div className={`scoreboard${overlay ? " replay-scoreboard" : ""}`} aria-label="Match score">
    <span className="team-name blue-text">BLUE</span>
    <strong className="score blue-text">{metadata?.blueScore ?? "-"}</strong>
    <span className="game-clock">{clock}</span>
    <strong className="score orange-text">{metadata?.orangeScore ?? "-"}</strong>
    <span className="team-name orange-text">ORANGE</span>
  </div>;
}
