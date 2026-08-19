import { useEffect, useState } from "react";
import type { HttpReplayHistoryGateway } from "../../adapters/http/replay-history-gateway";
import type { ReplayHistoryItem } from "../../shared/contracts/replay-history";

export function ReplayHistoryPage({ gateway }: { gateway: HttpReplayHistoryGateway }) {
  const [replays, setReplays] = useState<ReplayHistoryItem[]>();
  const [confirming, setConfirming] = useState<string>();
  const [deleting, setDeleting] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void gateway.list()
      .then(items => { if (active) setReplays(items); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Could not load replay history."); });
    return () => { active = false; };
  }, [gateway]);

  const deleteReplay = async (id: string): Promise<void> => {
    setDeleting(id);
    setError(undefined);
    try {
      await gateway.delete(id);
      setReplays(current => current?.filter(replay => replay.id !== id));
      setConfirming(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not delete replay.");
    } finally {
      setDeleting(undefined);
    }
  };

  return <main className="app-shell replay-history-page">
    <header className="history-header">
      <div>
        <a className="back-link" href="/">Back to replay viewer</a>
        <p className="eyebrow">Your library</p>
        <h1>Replay history</h1>
        <p>Open past analyses or remove replays you no longer want to keep.</p>
      </div>
      {replays && <strong>{replays.length} {replays.length === 1 ? "replay" : "replays"}</strong>}
    </header>
    {error && <p className="history-error" role="alert">{error}</p>}
    {!replays && !error && <p className="history-status">Loading your replays...</p>}
    {replays?.length === 0 && <section className="history-empty">
      <h2>No saved replays</h2>
      <p>Upload a replay in the viewer and it will appear here.</p>
      <a href="/">Upload a replay</a>
    </section>}
    {replays && replays.length > 0 && <ol className="replay-history-list">
      {replays.map(replay => <li key={replay.id}>
        <a className="history-open" href={`/?replay=${encodeURIComponent(replay.id)}`}>
          <span className="history-file-mark" aria-hidden="true" />
          <span><strong>{replay.filename}</strong><small>Analyzed {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(replay.analyzedAt))}</small></span>
          <b>Open replay</b>
        </a>
        <div className="history-delete">
          {confirming === replay.id ? <>
            <span>Delete permanently?</span>
            <button className="delete-confirm" type="button" disabled={deleting === replay.id} onClick={() => void deleteReplay(replay.id)}>{deleting === replay.id ? "Deleting..." : "Yes, delete"}</button>
            <button type="button" disabled={deleting === replay.id} onClick={() => setConfirming(undefined)}>Cancel</button>
          </> : <button type="button" onClick={() => setConfirming(replay.id)}>Delete</button>}
        </div>
      </li>)}
    </ol>}
  </main>;
}
