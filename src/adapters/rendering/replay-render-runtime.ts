import type { InterpolatedReplayState } from "../../replay/types";
import type { RenderContext, ReplayRenderer } from "./types";

interface ReplayRenderFrame {
  state: InterpolatedReplayState;
  context: RenderContext;
}

interface ReplayRenderRuntimeOptions {
  canvasClassName?: string;
  canvasLabel: string;
  createRenderer(canvas: HTMLCanvasElement): ReplayRenderer;
  getFrame(deltaSeconds: number): ReplayRenderFrame;
  onError(error: unknown): void;
}

export class ReplayRenderRuntime {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: ReplayRenderer;
  private animationFrame = 0;
  private previousTime = 0;
  private running = false;
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly options: ReplayRenderRuntimeOptions,
  ) {
    this.canvas = container.ownerDocument.createElement("canvas");
    this.canvas.className = options.canvasClassName ?? "";
    this.canvas.setAttribute("aria-label", options.canvasLabel);
    container.append(this.canvas);
    try {
      this.renderer = options.createRenderer(this.canvas);
    } catch (error) {
      this.canvas.remove();
      throw error;
    }
  }

  start(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.previousTime = performance.now();
    this.container.ownerDocument.defaultView?.addEventListener("resize", this.onResize);
    this.animationFrame = requestAnimationFrame(this.renderFrame);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.animationFrame);
    this.container.ownerDocument.defaultView?.removeEventListener("resize", this.onResize);
    this.renderer.dispose();
    this.canvas.remove();
  }

  private readonly onResize = (): void => {
    this.renderer.resize();
  };

  private readonly renderFrame = (now: number): void => {
    if (!this.running) return;
    this.animationFrame = requestAnimationFrame(this.renderFrame);
    const deltaSeconds = (now - this.previousTime) / 1000;
    this.previousTime = now;
    try {
      const frame = this.options.getFrame(deltaSeconds);
      this.renderer.render(frame.state, frame.context);
    } catch (error) {
      this.running = false;
      cancelAnimationFrame(this.animationFrame);
      this.options.onError(error);
    }
  };
}
