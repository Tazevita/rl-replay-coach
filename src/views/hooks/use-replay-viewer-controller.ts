import { useEffect, useRef, useSyncExternalStore } from "react";
import type { ReplayViewerController } from "../../application/controllers/replay-viewer-controller";

export function useReplayViewerController(controller: ReplayViewerController) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const startedController = useRef<ReplayViewerController | null>(null);
  useEffect(() => {
    if (startedController.current === controller) return;
    startedController.current = controller;
    void controller.loadInitialReplay();
  }, [controller]);
  return state;
}
