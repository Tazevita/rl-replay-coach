// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlayerMistakesGateway } from "../../adapters/http/player-mistakes-gateway";
import { CheckPlayerPage } from "./CheckPlayerPage";

afterEach(cleanup);

describe("CheckPlayerPage", () => {
  it("searches a trimmed username and renders every saved mistake", async () => {
    const replayContext = {
      sampleIntervalSeconds: 0.25 as const,
      startSeconds: 47.75,
      endSeconds: 48,
      goalBoundarySeconds: null,
      samples: [{
        timeSeconds: 48,
        ball: { x: 0, y: 100, z: 93 },
        players: [{
          actorId: 1,
          displayName: "Alpha",
          team: "blue" as const,
          position: { x: 0, y: 0, z: 17 },
          yaw: 0,
          rotation: null,
        }],
      }],
    };
    const explanation = { text: "Rotate behind your teammate before challenging.", generatedAt: "2026-08-19T12:00:00.000Z", model: "gpt-5.6", promptVersion: "1" };
    const weaknesses = {
      username: "Alpha", generatedAt: "2026-08-19T12:00:00.000Z", model: "gpt-5.6-luna", promptVersion: "1",
      weaknesses: [{ weakness: "Recover before committing", pattern: "You repeatedly challenge before restoring a useful defensive position.", workOn: "Rotate goal-side before deciding whether to challenge.", remember: "When you lose the play, rotate behind your teammate." }],
    };
    const gateway: PlayerMistakesGateway = { getByUsername: vi.fn(async () => ({
      username: "Alpha", createdBy: "johndoe", playerIds: ["alpha"], replayCount: 2, totalMistakes: 2,
      tacticalFocus: [{ expectedFamily: "RECOVER", actualFamily: "ENGAGE", count: 2, averageScore: 1.25 }],
      decisionHabits: [{ expectedIntent: "FAR_ROTATE", actualIntent: "CLOSE_ROTATE", count: 2, averageScore: 1.25 }],
      mistakes: [1, 2].map(number => ({
        id: String(number), replayId: `replay-${number}`, replayFilename: `match-${number}.replay`, playerId: "alpha", displayName: "Alpha",
        eventId: `event-${number}`, occurredAtSeconds: 50 + number, anchorSeconds: 48,
        expectedFamily: "RECOVER", actualFamily: "ENGAGE", expectedIntent: "CLOSE_ROTATE", actualIntent: "CHALLENGE",
        score: number, sampleCount: 2, window: "1-2s", text: `Mistake ${number}`, analyzedAt: "2026-08-17T12:00:00.000Z", replayContext, explanation: null,
      })),
    })), explain: vi.fn(async mistakeId => ({ mistakeId, explanation })), getWeaknesses: vi.fn(async () => weaknesses) };
    render(<CheckPlayerPage gateway={gateway} />);
    await userEvent.type(screen.getByLabelText("Player username"), "  Alpha  ");
    fireEvent.change(screen.getByLabelText("Replay context"), { target: { value: "5" } });
    await userEvent.click(screen.getByRole("button", { name: "Analyze player" }));
    expect(gateway.getByUsername).toHaveBeenCalledWith("Alpha", 5);
    expect(await screen.findByText("Mistake 1")).toBeInTheDocument();
    expect(screen.getByText("Mistake 2")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tactical mistakes" })).toBeInTheDocument();
    expect(screen.getByText("You tend to Engage when it's better to Recover.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Decision habit mistakes" })).toBeInTheDocument();
    expect(screen.getByText("You tend to Close Rotate when it's better to Far Rotate.")).toBeInTheDocument();
    expect(screen.getAllByText("2x")).toHaveLength(2);
    const mistakeLink = screen.getByRole("link", { name: "Open match-1.replay at 48.0 seconds" });
    expect(mistakeLink).toHaveAttribute("href", "/?replay=replay-1&at=48");
    expect(mistakeLink).toHaveAttribute("target", "_blank");
    expect(mistakeLink).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.queryByRole("button", { name: "Copy context" })).not.toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Explain mistake" })[0]);
    expect(gateway.explain).toHaveBeenCalledWith("1");
    expect(await screen.findByText(explanation.text)).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Explain mistake" })).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Find priorities" }));
    expect(gateway.getWeaknesses).toHaveBeenCalledWith("Alpha", 5);
    expect(await screen.findByText("Recover before committing")).toBeVisible();
    expect(screen.getByText("Rotate goal-side before deciding whether to challenge.")).toBeVisible();
    expect(screen.getByText("When you lose the play, rotate behind your teammate.")).toBeVisible();
  });

  it("shows an empty-player result", async () => {
    const gateway: PlayerMistakesGateway = { getByUsername: vi.fn(async username => ({
      username, createdBy: "johndoe", playerIds: [], replayCount: 0, totalMistakes: 0, tacticalFocus: [], decisionHabits: [], mistakes: [],
    })), explain: vi.fn(), getWeaknesses: vi.fn() };
    render(<CheckPlayerPage gateway={gateway} />);
    await userEvent.type(screen.getByLabelText("Player username"), "Nobody");
    await userEvent.click(screen.getByRole("button", { name: "Analyze player" }));
    expect(await screen.findByText("No uploaded gameplay was found for this username.")).toBeInTheDocument();
  });
});
