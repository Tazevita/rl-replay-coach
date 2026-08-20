import { StrictMode, useMemo, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import { DefaultReplayViewerController } from "./application/controllers/replay-viewer-controller";
import { HttpReplayDataGateway } from "./adapters/http/replay-data-gateway";
import { HttpReplayProcessingGateway } from "./adapters/http/replay-processing-gateway";
import { App } from "./views/components/App";
import { CheckPlayerPage } from "./views/components/CheckPlayerPage";
import { HttpPlayerMistakesGateway } from "./adapters/http/player-mistakes-gateway";
import { authenticatedFetch } from "./adapters/http/authenticated-fetch";
import { AuthGate } from "./views/components/AuthGate";
import { HttpReplayHistoryGateway } from "./adapters/http/replay-history-gateway";
import { ReplayHistoryPage } from "./views/components/ReplayHistoryPage";
import "../styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Application mount point is missing.");
const path = window.location.pathname.replace(/\/+$/, "") || "/";
const query = new URLSearchParams(window.location.search);
const replayId = query.get("replay")?.trim();
const requestedTime = Number(query.get("at"));
const sourceTime = query.has("at") && Number.isFinite(requestedTime) && requestedTime >= 0 ? requestedTime : undefined;
const replayDataUrl = replayId ? `/api/replays/${encodeURIComponent(replayId)}/data` : undefined;
const replayBundleUrl = replayId ? `/api/replays/${encodeURIComponent(replayId)}` : undefined;
function AuthenticatedApp({ session }: { session: Session }) {
  const accessToken = useRef(session.access_token);
  accessToken.current = session.access_token;
  const request = useMemo(() => authenticatedFetch(() => accessToken.current), []);
  const mistakesGateway = useMemo(() => new HttpPlayerMistakesGateway(request), [request]);
  const historyGateway = useMemo(() => new HttpReplayHistoryGateway(request), [request]);
  const controller = useMemo(() => new DefaultReplayViewerController(
    new HttpReplayProcessingGateway(1_000, milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)), request),
    new HttpReplayDataGateway(request),
    replayDataUrl,
    replayBundleUrl,
    sourceTime,
  ), [request]);

  return path === "/check-player"
    ? <CheckPlayerPage gateway={mistakesGateway} />
    : path === "/replay-history"
      ? <ReplayHistoryPage gateway={historyGateway} />
      : <App mistakesGateway={mistakesGateway} controller={controller} mode={path === "/who-threw" ? "who-threw" : "teams"} />;
}

createRoot(root).render(<StrictMode><AuthGate>{session => <AuthenticatedApp session={session} />}</AuthGate></StrictMode>);
