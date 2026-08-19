import type { ReplayViewerError } from "../../application/controllers/replay-viewer-controller";

export function LoadingOverlay({ loading, processing, error, hasReplay }: { loading: boolean; processing: boolean; error: ReplayViewerError | null; hasReplay: boolean }) {
  const visible = loading || processing || (!hasReplay && Boolean(error));
  const title = processing ? "Analyzing replay" : loading ? "Reading replay" : error?.operation === "upload" ? "Replay analysis failed" : "Replay could not be loaded";
  const detail = processing
    ? "rrrocket parse, then Blue and Orange goal analysis..."
    : loading ? "Building player and ball tracks..." : error?.message;
  return <div className={`loading${visible ? "" : " hidden"}`} role={error && visible ? "alert" : "status"}>
    {(loading || processing) && <div className="loader" />}
    <strong>{title}</strong>
    <span>{detail}</span>
  </div>;
}
