import { useState, type FormEvent } from "react";
import type { PlayerMistakesGateway } from "../../adapters/http/player-mistakes-gateway";
import type { PlayerMistakesResponse, PlayerWeaknessesResponse } from "../../shared/contracts/player-mistakes";
import { InfoCard } from "./InfoCard";

function label(value: string): string {
  return value.toLowerCase().replaceAll("_", " ");
}

function titleLabel(value: string): string {
  return label(value).replace(/\b\w/g, character => character.toUpperCase());
}

export function CheckPlayerPage({ gateway }: { gateway: PlayerMistakesGateway }) {
  const [username, setUsername] = useState("");
  const [replayLimit, setReplayLimit] = useState(50);
  const [result, setResult] = useState<PlayerMistakesResponse | null>(null);
  const [resultReplayLimit, setResultReplayLimit] = useState(50);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [explaining, setExplaining] = useState<Record<string, boolean>>({});
  const [explanationErrors, setExplanationErrors] = useState<Record<string, string>>({});
  const [weaknesses, setWeaknesses] = useState<PlayerWeaknessesResponse | null>(null);
  const [analyzingWeaknesses, setAnalyzingWeaknesses] = useState(false);
  const [weaknessesError, setWeaknessesError] = useState<string | null>(null);

  const explain = async (id: string): Promise<void> => {
    setExplaining(current => ({ ...current, [id]: true }));
    setExplanationErrors(current => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    try {
      const response = await gateway.explain(id);
      setResult(current => current ? {
        ...current,
        mistakes: current.mistakes.map(mistake => mistake.id === id
          ? { ...mistake, explanation: response.explanation }
          : mistake),
      } : current);
    } catch (caught) {
      setExplanationErrors(current => ({
        ...current,
        [id]: caught instanceof Error ? caught.message : "Could not explain the mistake.",
      }));
    } finally {
      setExplaining(current => ({ ...current, [id]: false }));
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const query = username.trim();
    if (!query || loading) return;
    setLoading(true);
    setError(null);
    setWeaknesses(null);
    setWeaknessesError(null);
    try {
      setResult(await gateway.getByUsername(query, replayLimit));
      setResultReplayLimit(replayLimit);
    } catch (caught) {
      setResult(null);
      setError(caught instanceof Error ? caught.message : "Could not load player mistakes.");
    } finally {
      setLoading(false);
    }
  };

  const analyzeWeaknesses = async (): Promise<void> => {
    if (!result || analyzingWeaknesses) return;
    setAnalyzingWeaknesses(true);
    setWeaknessesError(null);
    try {
      setWeaknesses(await gateway.getWeaknesses(result.username, resultReplayLimit));
    } catch (caught) {
      setWeaknessesError(caught instanceof Error ? caught.message : "Could not analyze this player.");
    } finally {
      setAnalyzingWeaknesses(false);
    }
  };

  return <main className="app-shell check-player-page">
    <header className="check-player-header">
      <a className="back-link" href="/">Replay viewer</a>
      <p className="eyebrow">Player development</p>
      <h1>Find the pattern.<br /><span>Fix the next play.</span></h1>
      <p className="check-player-intro">Search a Rocket League username to review sustained decision mistakes from uploaded replays.</p>
      <a className="context-guide-link" href="/guides#player-analysis">Watch the Player Analysis guide <span aria-hidden="true">→</span></a>
    </header>

    <form className="player-search" onSubmit={submit}>
      <label htmlFor="player-username">Player username</label>
      <div className="player-search-row">
        <input
          id="player-username"
          value={username}
          onChange={event => setUsername(event.target.value)}
          placeholder="e.g. ApparentlyJack"
          autoComplete="off"
        />
        <button type="submit" disabled={!username.trim() || loading}>{loading ? "Analyzing..." : "Analyze player"}</button>
      </div>
      <div className="replay-context-control">
        <div className="control-with-info">
          <label htmlFor="replay-context-count">Replay context</label>
          <InfoCard title="Replay context">Sets how many of this player's latest uploaded replays are searched for sustained mistakes and coaching patterns. More replays provide broader context, up to 50.</InfoCard>
        </div>
        <input
          id="replay-context-count"
          type="range"
          min="1"
          max="50"
          value={replayLimit}
          onChange={event => setReplayLimit(Number(event.target.value))}
        />
        <span>Use the latest {replayLimit} {replayLimit === 1 ? "replay" : "replays"} (maximum 50).</span>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {loading && <p className="search-status" role="status">Reviewing saved gameplay...</p>}
    </form>

    {result && <section className="player-results" aria-live="polite">
      <div className="result-summary">
        <p className="eyebrow">Analysis for</p>
        <h2>{result.username}</h2>
        <div className="result-stats">
          <div><strong>{result.totalMistakes}</strong><span>Sustained mistakes</span></div>
          <div><strong>{result.replayCount}</strong><span>Replays reviewed</span></div>
        </div>
        {!result.playerIds.length && <p className="empty-result">No uploaded gameplay was found for this username.</p>}
        {result.playerIds.length > 0 && !result.mistakes.length && <p className="empty-result">Gameplay found, with no sustained mistakes detected.</p>}
      </div>

      {result.mistakes.length > 0 && <div className="work-on-section">
        <div className="work-on-heading">
          <div>
            <h2>Coaching priorities</h2>
            <p>The recurring decisions to address first.</p>
          </div>
          <button type="button" disabled={analyzingWeaknesses} onClick={() => void analyzeWeaknesses()}>
            {analyzingWeaknesses ? "Finding priorities..." : weaknesses ? "Refresh priorities" : "Find priorities"}
          </button>
        </div>
        {weaknessesError && <p className="work-on-error" role="alert">{weaknessesError}</p>}
        {weaknesses && <ol className="weakness-list">
          {weaknesses.weaknesses.map((item, index) => <li key={item.weakness}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div>
              <h3>{item.weakness}</h3>
              <strong>What this means</strong>
              <p>{item.pattern}</p>
              <strong>Work on</strong>
              <p>{item.workOn}</p>
              <div className="remember-cue">
                <strong>Remember</strong>
                <p>{item.remember}</p>
              </div>
            </div>
          </li>)}
        </ol>}
      </div>}

      {result.tacticalFocus.length > 0 && <div className="common-mistakes">
        <div className="section-title">
          <p className="eyebrow">High-level priority</p>
          <h2>Tactical mistakes</h2>
          <p>Which broad approach would have been stronger in the moment.</p>
        </div>
        <div className="category-grid">
          {result.tacticalFocus.map((item, index) => <article className="category-card" key={`${item.expectedFamily}-${item.actualFamily}`}>
            <span className="category-rank">{String(index + 1).padStart(2, "0")}</span>
            <strong>You tend to {titleLabel(item.actualFamily)} when it's better to {titleLabel(item.expectedFamily)}.</strong>
            <div><b>{item.count}x</b><span>avg score {item.averageScore.toFixed(2)}</span></div>
          </article>)}
        </div>
      </div>}

      {result.decisionHabits.length > 0 && <div className="common-mistakes">
        <div className="section-title">
          <p className="eyebrow">Specific adjustment</p>
          <h2>Decision habit mistakes</h2>
          <p>The concrete choices that most often need to change.</p>
        </div>
        <div className="category-grid">
          {result.decisionHabits.map((item, index) => <article className="category-card decision-card" key={`${item.expectedIntent}-${item.actualIntent}`}>
            <span className="category-rank">{String(index + 1).padStart(2, "0")}</span>
            <strong>You tend to {titleLabel(item.actualIntent)} when it's better to {titleLabel(item.expectedIntent)}.</strong>
            <div><b>{item.count}x</b><span>avg score {item.averageScore.toFixed(2)}</span></div>
          </article>)}
        </div>
      </div>}

      {result.mistakes.length > 0 && <div className="mistake-history">
        <div className="section-title"><p className="eyebrow">Every occurrence</p><h2>Mistake history</h2></div>
        <div className="mistake-list">
          {result.mistakes.map(mistake => <article className="mistake-row" key={mistake.id}>
            <a
              className="mistake-open"
              href={`/?replay=${encodeURIComponent(mistake.replayId)}&at=${encodeURIComponent(mistake.anchorSeconds)}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${mistake.replayFilename} at ${mistake.anchorSeconds.toFixed(1)} seconds`}
            >
              <div className="mistake-marker" />
              <div className="mistake-copy">
                <div className="mistake-meta"><span>{mistake.replayFilename}</span><span>{mistake.occurredAtSeconds.toFixed(1)}s</span><span>{new Date(mistake.analyzedAt).toLocaleDateString()}</span></div>
                <h3>{label(mistake.actualFamily)} instead of {label(mistake.expectedFamily)}</h3>
                <p>{mistake.text}</p>
                {mistake.explanation && <div className="mistake-explanation">
                  <strong>Simple explanation</strong>
                  <p>{mistake.explanation.text}</p>
                </div>}
              </div>
              <div className="mistake-score"><strong>{mistake.score.toFixed(2)}</strong><span>score</span></div>
            </a>
            <div className="mistake-actions">
              {!mistake.explanation && <button
                className="explain-mistake-button"
                type="button"
                disabled={!mistake.replayContext || explaining[mistake.id]}
                title={mistake.replayContext ? "Generate a short explanation" : "Replay context unavailable"}
                onClick={() => void explain(mistake.id)}
              >
                {explaining[mistake.id] ? "Explaining..." : "Explain mistake"}
              </button>}
              {explanationErrors[mistake.id] && <p className="mistake-explanation-error" role="alert">{explanationErrors[mistake.id]}</p>}
            </div>
          </article>)}
        </div>
      </div>}
    </section>}
  </main>;
}
