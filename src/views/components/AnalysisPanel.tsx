import { useState } from "react";
import type { AnalysisEvent, AnalysisFinding, TeamAnalysis } from "../../shared/contracts/replay-analysis-v2";
import type { MistakeExplanation } from "../../shared/contracts/player-mistakes";
import type { PlayerMistakesGateway } from "../../adapters/http/player-mistakes-gateway";
import { formatTime } from "../../replay/metadata";
import type { PredictionHorizon } from "../../replay/predictions";
import { InfoCard } from "./InfoCard";

const MISTAKE_CONTEXT_SECONDS = 3;

export interface AnalysisNavigationOptions {
  subject: NonNullable<AnalysisFinding["subject"]>;
  teamId: TeamAnalysis["team"]["id"];
  autoProjection: boolean;
  autoCamera: boolean;
  projectedHorizon?: PredictionHorizon;
}

interface AnalysisPanelProps {
  teams: readonly TeamAnalysis[];
  processing: boolean;
  uploadError: string | null;
  mode?: "teams" | "who-threw";
  replayId?: string | null;
  mistakesGateway?: PlayerMistakesGateway;
  clockAtSourceTime?(sourceTime: number): string | undefined;
  onNavigate(sourceTime: number, options?: AnalysisNavigationOptions): void;
}

export function AnalysisPanel({ teams, processing, uploadError, mode = "teams", replayId, mistakesGateway, clockAtSourceTime, onNavigate }: AnalysisPanelProps) {
  const [includeContext, setIncludeContext] = useState(false);
  const [autoProjection, setAutoProjection] = useState(true);
  const [autoCamera, setAutoCamera] = useState(false);
  const throwerReport = mode === "who-threw" ? calculateWhoThrew(teams) : null;
  const status = uploadError
    ?? (processing ? "Parsing replay and running both team analyses. This may take several minutes."
      : teams.length ? mode === "who-threw"
        ? "Only the losing team's most frequent contributor to conceded goals is shown."
        : "Select any timestamp to jump to that moment in the replay."
        : "Upload a replay to generate analysis for both teams.");
  return <section className={`analysis analysis-${mode}`} aria-live="polite">
    <div className="analysis-heading">
      <div><h2>{mode === "who-threw" ? "Who threw?" : "Team analysis"}</h2><span className={uploadError ? "error" : ""}>{status}</span></div>
      <div className="analysis-heading-meta">
        <strong>Jump behavior</strong>
        <div className="control-with-info">
          <label className="analysis-context-toggle">
            <input type="checkbox" checked={includeContext} onChange={event => setIncludeContext(event.currentTarget.checked)} />
            <span>3 Seconds Before Mistake</span>
          </label>
          <InfoCard title="3 Seconds Before Mistake">Starts playback three seconds before the marked mistake so you can see how the play developed. Turn it off to jump directly to the marked moment.</InfoCard>
        </div>
        {mode === "teams" && <div className="control-with-info">
          <label className="analysis-context-toggle">
            <input type="checkbox" checked={autoProjection} onChange={event => setAutoProjection(event.currentTarget.checked)} />
            <span>Auto-switch projection</span>
          </label>
          <InfoCard title="Auto-switch projection">When you select a mistake, projected cars are enabled for the involved player and the matching prediction timeframe is selected when available.</InfoCard>
        </div>}
        <div className="control-with-info">
          <label className="analysis-context-toggle">
            <input type="checkbox" checked={autoCamera} onChange={event => setAutoCamera(event.currentTarget.checked)} />
            <span>Auto-switch camera</span>
          </label>
          <InfoCard title="Auto-switch camera">When you select a mistake, the replay camera switches to follow the involved player. The current camera remains if that player cannot be matched.</InfoCard>
        </div>
      </div>
    </div>
    {mode === "who-threw"
      ? <WhoThrewReport report={throwerReport} includeContext={includeContext} autoCamera={autoCamera} replayId={replayId} mistakesGateway={mistakesGateway} clockAtSourceTime={clockAtSourceTime} onNavigate={onNavigate} />
      : <TeamAnalysisTimeline teams={teams} includeContext={includeContext} autoProjection={autoProjection} autoCamera={autoCamera} replayId={replayId} mistakesGateway={mistakesGateway} clockAtSourceTime={clockAtSourceTime} onNavigate={onNavigate} />}
  </section>;
}

interface TimelineEvent {
  occurredAtSeconds: number;
  displayClock?: string;
  blue?: AnalysisEvent;
  orange?: AnalysisEvent;
}

function TeamAnalysisTimeline({ teams, includeContext, autoProjection, autoCamera, replayId, mistakesGateway, clockAtSourceTime, onNavigate }: { teams: readonly TeamAnalysis[]; includeContext: boolean; autoProjection: boolean; autoCamera: boolean; replayId?: string | null; mistakesGateway?: PlayerMistakesGateway; clockAtSourceTime?: AnalysisPanelProps["clockAtSourceTime"]; onNavigate: AnalysisPanelProps["onNavigate"] }) {
  const blue = teams.find(team => team.team.id === "blue");
  const orange = teams.find(team => team.team.id === "orange");
  const events = buildTimeline(teams);
  if (!teams.length) return <p className="analysis-empty analysis-empty-panel">Upload a replay to begin the match review.</p>;
  return <div className="match-review">
    <div className="match-review-teams">
      <TeamTimelineHeader team={blue} side="blue" />
      <div className="timeline-axis-label">Match timeline</div>
      <TeamTimelineHeader team={orange} side="orange" />
    </div>
    {(blue && !blue.events.length || orange && !orange.events.length) && <div className="analysis-team-empty">
      {blue && !blue.events.length && <span><b>Blue</b> No goals or goal-related findings were reported.</span>}
      {orange && !orange.events.length && <span><b>Orange</b> No goals or goal-related findings were reported.</span>}
    </div>}
    <div className="match-timeline">
      {events.map(event => <section className="match-timeline-event" key={event.occurredAtSeconds}>
        <div className="timeline-lane timeline-lane-blue">
          {event.blue && blue && <AnalysisEventView event={event.blue} includeContext={includeContext} autoProjection={autoProjection} autoCamera={autoCamera} teamId="blue" replayId={replayId} mistakesGateway={mistakesGateway} clockAtSourceTime={clockAtSourceTime} onNavigate={onNavigate} />}
        </div>
        <button className="timeline-marker" type="button" onClick={() => onNavigate(event.occurredAtSeconds)} aria-label={`Jump to ${analysisClock(event.occurredAtSeconds, event.displayClock, clockAtSourceTime)}`}>
          <span>{analysisClock(event.occurredAtSeconds, event.displayClock, clockAtSourceTime)}</span>
          <i aria-hidden="true" />
        </button>
        <div className="timeline-lane timeline-lane-orange">
          {event.orange && orange && <AnalysisEventView event={event.orange} includeContext={includeContext} autoProjection={autoProjection} autoCamera={autoCamera} teamId="orange" replayId={replayId} mistakesGateway={mistakesGateway} clockAtSourceTime={clockAtSourceTime} onNavigate={onNavigate} />}
        </div>
      </section>)}
    </div>
  </div>;
}

function TeamTimelineHeader({ team, side }: { team?: TeamAnalysis; side: "blue" | "orange" }) {
  return <header className={`timeline-team timeline-team-${side}`}>
    <span>{side}</span>
    <div><h3>{team ? `${team.team.displayName} team` : `${side} team`}</h3><p>{team?.players.map(player => player.displayName).join(" + ") || "Roster unavailable"}</p></div>
    {team && <strong>{team.score.for}<small>goals</small></strong>}
  </header>;
}

function buildTimeline(teams: readonly TeamAnalysis[]): TimelineEvent[] {
  const timeline = new Map<number, TimelineEvent>();
  for (const team of teams) {
    for (const event of team.events) {
      const current = timeline.get(event.occurredAtSeconds) ?? {
        occurredAtSeconds: event.occurredAtSeconds,
        displayClock: event.displayClock,
      };
      current[team.team.id] = event;
      timeline.set(event.occurredAtSeconds, current);
    }
  }
  return [...timeline.values()].sort((left, right) => left.occurredAtSeconds - right.occurredAtSeconds);
}

export interface WhoThrewGoal {
  event: AnalysisEvent;
  findings: readonly AnalysisFinding[];
  faultPercent: number;
}

export interface WhoThrewResult {
  team: TeamAnalysis;
  player: NonNullable<AnalysisFinding["subject"]>;
  mistakeCount: number;
  averageFaultPercent: number;
  goals: readonly WhoThrewGoal[];
}

export function calculateWhoThrew(teams: readonly TeamAnalysis[]): WhoThrewResult | null {
  const losingTeam = teams.find(team => team.score.for < team.score.against);
  if (!losingTeam) return null;
  const conceded = losingTeam.events.filter(event => event.relation === "conceded");
  const counts: Array<{ subject: NonNullable<AnalysisFinding["subject"]>; count: number; order: number }> = [];
  for (const event of conceded) {
    for (const finding of event.findings) {
      if (!isMistake(finding) || !finding.subject) continue;
      const current = counts.find(item => sameSubject(item.subject, finding.subject!));
      if (current) current.count += 1;
      else {
        const rosterIndex = losingTeam.players.findIndex(player => sameSubject(player, finding.subject!));
        counts.push({ subject: finding.subject, count: 1, order: rosterIndex < 0 ? losingTeam.players.length + counts.length : rosterIndex });
      }
    }
  }
  const thrower = counts.sort((left, right) => right.count - left.count || left.order - right.order)[0];
  if (!thrower) return null;
  const goals = conceded.map(event => {
    const mistakes = event.findings.filter(isMistake);
    const findings = mistakes.filter(finding => finding.subject && sameSubject(finding.subject, thrower.subject));
    return {
      event,
      findings,
      faultPercent: mistakes.length ? Math.round(findings.length / mistakes.length * 100) : 0,
    };
  });
  return {
    team: losingTeam,
    player: thrower.subject,
    mistakeCount: thrower.count,
    averageFaultPercent: goals.length ? Math.round(goals.reduce((total, goal) => total + goal.faultPercent, 0) / goals.length) : 0,
    goals,
  };
}

function WhoThrewReport({ report, includeContext, autoCamera, replayId, mistakesGateway, clockAtSourceTime, onNavigate }: { report: WhoThrewResult | null; includeContext: boolean; autoCamera: boolean; replayId?: string | null; mistakesGateway?: PlayerMistakesGateway; clockAtSourceTime?: AnalysisPanelProps["clockAtSourceTime"]; onNavigate: AnalysisPanelProps["onNavigate"] }) {
  if (!report) return <p className="who-threw-empty">A losing team with attributed mistakes is needed to identify who threw.</p>;
  return <article className={`team-report who-threw-report ${report.team.team.id}`}>
    <header className="who-threw-summary">
      <div><p className="eyebrow">Most mistakes on the losing team</p><h3>{report.player.displayName}</h3><span>{report.team.team.displayName} team · {report.mistakeCount} {report.mistakeCount === 1 ? "mistake" : "mistakes"}</span></div>
      <div className="fault-average"><strong>{report.averageFaultPercent}%</strong><span>average fault per conceded goal</span></div>
    </header>
    <div className="analysis-events">{report.goals.map(goal => <section className="analysis-event relation-conceded" key={goal.event.id}>
      <button className="analysis-goal" type="button" onClick={() => onNavigate(goal.event.occurredAtSeconds)}>
        <span className="event-stamp">{analysisClock(goal.event.occurredAtSeconds, goal.event.displayClock, clockAtSourceTime)}<small>conceded</small></span>
        <span className="event-detail"><strong>Goal conceded {goal.event.ordinal}</strong></span>
        <span className="goal-fault"><strong>{goal.faultPercent}%</strong><small>{report.player.displayName}'s fault</small></span>
      </button>
      <div className="analysis-findings">{goal.findings.length
        ? goal.findings.map(finding => <Finding key={finding.id} finding={finding} includeContext={includeContext} autoProjection={false} autoCamera={autoCamera} teamId={report.team.team.id} replayId={replayId} mistakesGateway={mistakesGateway} clockAtSourceTime={clockAtSourceTime} onNavigate={onNavigate} />)
        : <div className="analysis-note">No mistake from {report.player.displayName} contributed to this goal.</div>}
      </div>
    </section>)}</div>
  </article>;
}

function isMistake(finding: AnalysisFinding): boolean {
  return Boolean(finding.extensions?.mistake);
}

function sameSubject(left: NonNullable<AnalysisFinding["subject"]>, right: NonNullable<AnalysisFinding["subject"]>): boolean {
  if (left.playerId && right.playerId) return left.playerId === right.playerId;
  return left.displayName.trim().toLocaleLowerCase() === right.displayName.trim().toLocaleLowerCase();
}

export function TeamAnalysisCard({ team, includeContext = true, autoProjection = false, autoCamera = false, replayId, mistakesGateway, clockAtSourceTime, onNavigate }: { team: TeamAnalysis; includeContext?: boolean; autoProjection?: boolean; autoCamera?: boolean; replayId?: string | null; mistakesGateway?: PlayerMistakesGateway; clockAtSourceTime?: AnalysisPanelProps["clockAtSourceTime"]; onNavigate: AnalysisPanelProps["onNavigate"] }) {
  return <article className={`team-report ${team.team.id}`}>
    <header className="team-report-header">
      <div><h3>{team.team.displayName} team</h3><p>{team.players.map(player => player.displayName).join(" + ") || "Roster unavailable"}</p></div>
      <span className="team-record">{team.score.for} scored · {team.score.against} conceded</span>
    </header>
    <div className="analysis-events">{team.events.length
      ? team.events.map(event => <AnalysisEventView key={event.id} event={event} includeContext={includeContext} autoProjection={autoProjection} autoCamera={autoCamera} teamId={team.team.id} replayId={replayId} mistakesGateway={mistakesGateway} clockAtSourceTime={clockAtSourceTime} onNavigate={onNavigate} />)
      : <p className="analysis-empty">No goals or goal-related findings were reported.</p>}
    </div>
  </article>;
}

function AnalysisEventView({ event, includeContext, autoProjection, autoCamera, teamId, replayId, mistakesGateway, clockAtSourceTime, onNavigate }: { event: AnalysisEvent; includeContext: boolean; autoProjection: boolean; autoCamera: boolean; teamId: TeamAnalysis["team"]["id"]; replayId?: string | null; mistakesGateway?: PlayerMistakesGateway; clockAtSourceTime?: AnalysisPanelProps["clockAtSourceTime"]; onNavigate: AnalysisPanelProps["onNavigate"] }) {
  const title = event.relation === "scored" ? `Goal scored ${event.ordinal}` : `Goal conceded ${event.ordinal}`;
  const findings = [...event.findings].sort((left, right) =>
    (right.extensions?.mistake?.score ?? -1) - (left.extensions?.mistake?.score ?? -1));
  return <section className={`analysis-event relation-${event.relation}`}>
    <button className="analysis-goal" type="button" onClick={() => onNavigate(event.occurredAtSeconds)}>
      <span className="event-stamp">{analysisClock(event.occurredAtSeconds, event.displayClock, clockAtSourceTime)}<small>{event.relation}</small></span>
      <span className="event-detail"><strong>{title}</strong></span>
    </button>
    <div className="analysis-findings">{findings.length
      ? findings.map(finding => <Finding key={finding.id} finding={finding} includeContext={includeContext} autoProjection={autoProjection} autoCamera={autoCamera} teamId={teamId} replayId={replayId} mistakesGateway={mistakesGateway} clockAtSourceTime={clockAtSourceTime} onNavigate={onNavigate} />)
      : <div className="analysis-note">No sustained high-confidence finding was reported.</div>}
    </div>
  </section>;
}

function Finding({ finding, includeContext, autoProjection, autoCamera, teamId, replayId, mistakesGateway, clockAtSourceTime, onNavigate }: { finding: AnalysisFinding; includeContext: boolean; autoProjection: boolean; autoCamera: boolean; teamId: TeamAnalysis["team"]["id"]; replayId?: string | null; mistakesGateway?: PlayerMistakesGateway; clockAtSourceTime?: AnalysisPanelProps["clockAtSourceTime"]; onNavigate: AnalysisPanelProps["onNavigate"] }) {
  const mistake = finding.extensions?.mistake;
  const [explanation, setExplanation] = useState<MistakeExplanation | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [explanationError, setExplanationError] = useState<string | null>(null);
  const mistakeId = replayId && mistake && finding.kind === "disagreement"
    ? `${replayId}:${finding.id}`
    : null;
  const content = <>
    {finding.navigation && <span className="finding-stamp">{analysisClock(finding.navigation.anchorSeconds, undefined, clockAtSourceTime)}<small>{includeContext ? `${MISTAKE_CONTEXT_SECONDS}s context` : "exact moment"}</small></span>}
    <span className="finding-detail">{finding.text}</span>
  </>;
  const technicalDetails = mistake && <details className="finding-technical">
    <summary>Technical details</summary>
    <div className="finding-comparison">
        <span><strong>Likely happened</strong>{formatIntent(mistake.actualIntent, mistake.actualFamily)} <b>{formatConfidence(mistake.confidence.actual)}</b></span>
        <span><strong>Likely better play</strong>{formatIntent(mistake.expectedIntent, mistake.expectedFamily)} <b>{formatConfidence(mistake.confidence.expected)}</b></span>
    </div>
  </details>;
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
  if (!finding.navigation) return <div className="analysis-finding-shell"><div className={`analysis-finding tone-${finding.tone} no-navigation`}>{content}</div>{technicalDetails}{explanationAction}</div>;
  const seekTime = Math.max(0, finding.navigation.anchorSeconds - (includeContext ? MISTAKE_CONTEXT_SECONDS : 0));
  const navigate = (): void => {
    if ((autoProjection || autoCamera) && finding.subject) {
      onNavigate(seekTime, {
        subject: finding.subject,
        teamId,
        autoProjection,
        autoCamera,
        projectedHorizon: autoProjection ? predictionHorizonFrom(finding.text) : undefined,
      });
    }
    else onNavigate(seekTime);
  };
  return <div className="analysis-finding-shell">
    <button className={`analysis-finding tone-${finding.tone}`} type="button" onClick={navigate}>{content}</button>
    {technicalDetails}
    {explanationAction}
  </div>;
}

export function predictionHorizonFrom(text: string): PredictionHorizon | undefined {
  const match = text.match(/(?:^|[^\d.])(0\s*-\s*1|1\s*-\s*2|2\s*-\s*3\.5)\s*(?:s|seconds?)?\b/i);
  return match?.[1].replaceAll(" ", "") as PredictionHorizon | undefined;
}

function analysisClock(sourceTime: number, fallback: string | undefined, clockAtSourceTime: AnalysisPanelProps["clockAtSourceTime"]): string {
  return clockAtSourceTime?.(sourceTime) ?? fallback ?? formatTime(sourceTime);
}

function formatIntent(intent: string, family: string): string {
  const words = intent.toLowerCase().replaceAll("_", " ");
  return `${words} (${family.toLowerCase()})`;
}

function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}% confidence`;
}
