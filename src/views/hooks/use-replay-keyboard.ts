import { useEffect } from "react";

interface ReplayKeyboardActions {
  enabled: boolean;
  togglePlayback(): void;
  skip(seconds: number): void;
}

export function useReplayKeyboard(actions: ReplayKeyboardActions): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      if (!actions.enabled || (target instanceof Element && target.closest("input, select, textarea, button, [contenteditable='true']"))) return;
      if (event.code === "Space") {
        event.preventDefault();
        actions.togglePlayback();
      } else if (event.code === "ArrowLeft") actions.skip(-5);
      else if (event.code === "ArrowRight") actions.skip(5);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actions]);
}
