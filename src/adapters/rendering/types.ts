import type { GhostCar, InterpolatedReplayState } from "../../replay/types";

export interface RenderContext {
  deltaSeconds: number;
  autoCamera: boolean;
  trackedPlayerKey: string | null;
  ghostCars: readonly GhostCar[];
}

export interface ReplayRenderer {
  render(state: InterpolatedReplayState, context: RenderContext): void;
  resize(): void;
  dispose(): void;
}
