import type { InterpolatedReplayState, ProjectedCar } from "../../replay/types";

export interface RenderContext {
  deltaSeconds: number;
  autoCamera: boolean;
  trackedPlayerKey: string | null;
  projectedCars: readonly ProjectedCar[];
}

export interface ReplayRenderer {
  render(state: InterpolatedReplayState, context: RenderContext): void;
  resize(): void;
  dispose(): void;
}
