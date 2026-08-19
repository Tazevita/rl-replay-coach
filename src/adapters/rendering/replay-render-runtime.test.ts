// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReplayRenderer } from "./types";
import { ReplayRenderRuntime } from "./replay-render-runtime";

afterEach(() => vi.unstubAllGlobals());

describe("ReplayRenderRuntime", () => {
  it("owns one canvas and stops rendering after disposal", () => {
    let nextFrame: FrameRequestCallback | undefined;
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      nextFrame = callback;
      return 7;
    });
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);

    const renderer: ReplayRenderer = {
      render: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn(),
    };
    const container = document.createElement("div");
    const runtime = new ReplayRenderRuntime(container, {
      canvasLabel: "Replay canvas",
      createRenderer: () => renderer,
      getFrame: deltaSeconds => ({
        state: { cars: [], ball: null, frameIndex: 0 },
        context: { deltaSeconds, autoCamera: false, trackedPlayerKey: null, ghostCars: [] },
      }),
      onError: vi.fn(),
    });

    expect(container.querySelectorAll("canvas")).toHaveLength(1);
    runtime.start();
    nextFrame?.(performance.now() + 16);
    expect(renderer.render).toHaveBeenCalledOnce();

    runtime.dispose();
    runtime.dispose();
    expect(container.querySelectorAll("canvas")).toHaveLength(0);
    expect(renderer.dispose).toHaveBeenCalledOnce();
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });

  it("preserves elapsed playback time after a slow frame", () => {
    let nextFrame: FrameRequestCallback | undefined;
    vi.spyOn(performance, "now").mockReturnValue(1_000);
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      nextFrame = callback;
      return 7;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const getFrame = vi.fn(deltaSeconds => ({
      state: { cars: [], ball: null, frameIndex: 0 },
      context: { deltaSeconds, autoCamera: false, trackedPlayerKey: null, ghostCars: [] },
    }));
    const runtime = new ReplayRenderRuntime(document.createElement("div"), {
      canvasLabel: "Replay canvas",
      createRenderer: () => ({ render: vi.fn(), resize: vi.fn(), dispose: vi.fn() }),
      getFrame,
      onError: vi.fn(),
    });

    runtime.start();
    nextFrame?.(1_250);

    expect(getFrame).toHaveBeenCalledWith(.25);
    runtime.dispose();
  });

  it("removes its canvas when renderer construction fails", () => {
    const container = document.createElement("div");
    expect(() => new ReplayRenderRuntime(container, {
      canvasLabel: "Replay canvas",
      createRenderer: () => { throw new Error("WebGL unavailable"); },
      getFrame: () => { throw new Error("unreachable"); },
      onError: vi.fn(),
    })).toThrow("WebGL unavailable");
    expect(container.querySelector("canvas")).toBeNull();
  });
});
