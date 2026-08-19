import { useState } from "react";
import type { AnalysisEvent, AnalysisFinding, TeamAnalysis } from "../../shared/contracts/replay-analysis-v2";
import type { MistakeExplanation } from "../../shared/contracts/player-mistakes";
import type { PlayerMistakesGateway } from "../../adapters/http/player-mistakes-gateway";
import { formatTime } from "../../replay/metadata";
import type { PredictionHorizon } from "../../replay/predictions";

export interface AnalysisNavigationOptions {
  subject: NonNullable<AnalysisFinding["subject"]>;
  teamId: TeamAnalysis["team"]["id"];
  autoGhost: boolean;
  autoCamera: boolean;
  ghostHorizon?: PredictionHorizon;
}

interface AnalysisPanelProps {
  teams: readonly TeamAnalysis[];
  processing: boolean;
  uploadError: string | null;
  replayId?: string | null;
  mistakesGateway?: PlayerMistakesGateway;
  onNavigate(sourceTime: number, options?: AnalysisNavigationOptions): void;
}

export function AnalysisPanel({ teams, processing, uploadError, replayId, mistakesGateway, onNavigate }: AnalysisPanelProps) {
  const [includeContext, setIncludeContext] = useState(true);
  const [autoGhost, setAutoGhost] = useState(false);
  const [autoCamera, setAutoCamera] = useState(false);
  const status = uploadError
    ?? (processing ? "Parsing replay and running both team analyses. This may take several minutes."
      : teams.length ? "Select any timestamp to jump to that moment in the replay."
        : "Upload a replay to generate analysis for both teams.");
  return <section className="analysis" aria-live="polite">
    <div className="analysis-heading">
      <div><p className="eyebrow">Replay Goal Runner</p><h2>Team analysis</h2></div>
      <div className="analysis-heading-meta">
        <span className={uploadError ? "error" : ""}>{status}</span>
        <label className="analysis-context-toggle">
          <input type="checkbox" checked={includeContext} onChange={event => setIncludeContext(event.currentTarget.checked)} />
          <span>Include context before mistakes</span>
        </label>
        <label className="analysis-context-toggle">
          <input type="checkbox" checked={autoGhost} onChange={event => setAutoGhost(event.currentTarget.checked)} />
          <span>Auto-switch ghost</span>
        </label>
        <label className="analysis-context-toggle">
          <input type="checkbox" checked={autoCamera} onChange={event => setAutoCamera(event.currentTarget.checked)} />
          <span>Auto-switch camera</span>
        </label>
      </div>
    </div>
    <div className="team-analysis-grid">{teams.map(team => <TeamAnalysisCard key={team.id} team={team} includeContext={includeContext} autoGhost={autoGhost} autoCamera={autoCamera} replayId={replayId} mistakesGateway={mistakesGateway} onNavigate={onNavigate} />)}</div>
  </section>;
}

export function TeamAnalysisCard({ team, includeContext = true, autoGhost = false, autoCamera = false, replayId, mistakesGateway, onNavigate }: { team: TeamAnalysis; includeContext?: boolean; autoGhost?: boolean; autoCamera?: boolean; replayId?: string | null; mistakesGateway?: PlayerMistakesGateway; onNavigate: AnalysisPanelProps["onNavigate"] }) {
  return <article className={`team-report ${team.team.id}`}>
    <header className="team-report-header">
      <div><h3>{team.team.displayName} team</h3><p>{team.players.map(player => player.displayName).join(" + ") || "Roster unavailable"}</p></div>
      <span className="team-record">{team.score.for} scored · {team.score.against} conceded</span>
    </header>
    <div className="analysis-events">{team.events.length
      ? team.events.map(event => <AnalysisEventView key={event.id} event={event} includeContext={includeContext} autoGhost={autoGhost} autoCamera={autoCamera} teamId={team.team.id} replayId={replayId} mistakesGateway={mistakesGateway} onNavigate={onNavigate} />)
      : <p className="analysis-empty">No goals or goal-related findings were reported.</p>}
    </div>
  </article>;
}

function AnalysisEventView({ event, includeContext, autoGhost, autoCamera, teamId, replayId, mistakesGateway, onNavigate }: { event: AnalysisEvent; includeContext: boolean; autoGhost: boolean; autoCamera: boolean; teamId: TeamAnalysis["team"]["id"]; replayId?: string | null; mistakesGateway?: PlayerMistakesGateway; onNavigate: AnalysisPanelProps["onNavigate"] }) {
  const title = event.relation === "scored" ? `Goal scored ${event.ordinal}` : `Goal conceded ${event.ordinal}`;
  const findings = [...event.findings].sort((left, right) =>
    (right.extensions?.mistake?.score ?? -1) - (left.extensions?.mistake?.score ?? -1));
  return <section className={`analysis-event relation-${event.relation}`}>
    <button className="analysis-goal" type="button" onClick={() => onNavigate(event.occurredAtSeconds)}>
      <span className="event-stamp">{event.displayClock ?? formatTime(event.occurredAtSeconds)}<small>{event.relation}</small></span>
      <span className="event-detail"><strong>{title}</strong></span>
    </button>
    <div className="analysis-findings">{findings.length
      ? findings.map(finding => <Finding key={finding.id} finding={finding} includeContext={includeContext} autoGhost={autoGhost} autoCamera={autoCamera} teamId={teamId} replayId={replayId} mistakesGateway={mistakesGateway} onNavigate={onNavigate} />)
      : <div className="analysis-note">No sustained high-confidence finding was reported.</div>}
    </div>
  </section>;
}

function Finding({ finding, includeContext, autoGhost, autoCamera, teamId, replayId, mistakesGateway, onNavigate }: { finding: AnalysisFinding; includeContext: boolean; autoGhost: boolean; autoCamera: boolean; teamId: TeamAnalysis["team"]["id"]; replayId?: string | null; mistakesGateway?: PlayerMistakesGateway; onNavigate: AnalysisPanelProps["onNavigate"] }) {
  const mistake = finding.extensions?.mistake;
  const [explanation, setExplanation] = useState<MistakeExplanation | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [explanationError, setExplanationError] = useState<string | null>(null);
  const mistakeId = replayId && mistake?.sustained && finding.kind === "disagreement"
    ? `${replayId}:${finding.id}`
    : null;
  const content = <>
    {finding.navigation && <span className="finding-stamp">{formatTime(finding.navigation.anchorSeconds)}<small>{includeContext ? `${formatPreRoll(finding.navigation.preRollSeconds)} context` : "exact moment"}</small></span>}
    <span className="finding-detail">
      <span>{finding.text}</span>
      {mistake && <span className="finding-comparison">
        <span><strong>Likely happened</strong>{formatIntent(mistake.actualIntent, mistake.actualFamily)} <b>{formatConfidence(mistake.confidence.actual)}</b></span>
        <span><strong>Likely better play</strong>{formatIntent(mistake.expectedIntent, mistake.expectedFamily)} <b>{formatConfidence(mistake.confidence.expected)}</b></span>
      </span>}
    </span>
  </>;
  const explanationAction = mistakeId && mistakesGateway && <div className="finding-explanation-action">
    {!explanation && <button
      type="button"
      disabled={explaining}
      onClick={async () => {
        setExplaining(true);
        setExplanationError(null);
        try {
          setExplanation((await mistakesGateway.explain(mistakeId)).explanation);
        } catch (error) {
          setExplanationError(error instanceof Error ? error.message : "Could not explain the mistake.");
        } finally {
          setExplaining(false);
        }
      }}
    >{explaining ? "Explaining..." : "Explain mistake"}</button>}
    {explanation && <p><strong>Simple explanation</strong>{explanation.text}</p>}
    {explanationError && <span role="alert">{explanationError}</span>}
  </div>;
  if (!finding.navigation) return <div className="analysis-finding-shell"><div className={`analysis-finding tone-${finding.tone} no-navigation`}>{content}</div>{explanationAction}</div>;
  const seekTime = Math.max(0, finding.navigation.anchorSeconds - (includeContext ? finding.navigation.preRollSeconds : 0));
  const navigate = (): void => {
    if ((autoGhost || autoCamera) && finding.subject) {
      onNavigate(seekTime, {
        subject: finding.subject,
        teamId,
        autoGhost,
        autoCamera,
        ghostHorizon: autoGhost ? predictionHorizonFrom(finding.text) : undefined,
      });
    }
    else onNavigate(seekTime);
  };
  return <div className="analysis-finding-shell">
    <button className={`analysis-finding tone-${finding.tone}`} type="button" onClick={navigate}>{content}</button>
    {explanationAction}
  </div>;
}

export function predictionHorizonFrom(text: string): PredictionHorizon | undefined {
  const match = text.match(/(?:^|[^\d.])(0\s*-\s*1|1\s*-\s*2|2\s*-\s*3\.5)\s*(?:s|seconds?)?\b/i);
  return match?.[1].replaceAll(" ", "") as PredictionHorizon | undefined;
}

function formatPreRoll(seconds: number): string {
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;
}

function formatIntent(intent: string, family: string): string {
  const words = intent.toLowerCase().replaceAll("_", " ");
  return `${words} (${family.toLowerCase()})`;
}

function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}% confidence`;
}
