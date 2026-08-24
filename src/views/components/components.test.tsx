// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TeamAnalysis } from "../../shared/contracts/replay-analysis-v2";
import type { ReplayMetadata } from "../../replay/types";
import { AnalysisPanel, calculateWhoThrew, predictionHorizonFrom } from "./AnalysisPanel";
import { LoadingOverlay } from "./LoadingOverlay";
import { PlaybackControls } from "./PlaybackControls";
import { PlayerSidebar, PlayerTracker, ProjectedCarSettings } from "./PlayerSidebar";
import { ReplayToolbar, Scoreboard, UploadControl, ViewSelector } from "./ReplayToolbar";
import { useReplayKeyboard } from "../hooks/use-replay-keyboard";
import { areSignupsEnabled, PasswordField } from "./AuthGate";

afterEach(cleanup);

describe("authentication", () => {
  it("enables registration by default and supports an explicit shutdown", () => {
    expect(areSignupsEnabled(undefined)).toBe(true);
    expect(areSignupsEnabled("true")).toBe(true);
    expect(areSignupsEnabled("false")).toBe(false);
  });

  it("shows passwords on request and asks users to confirm new passwords", async () => {
    render(<>
      <PasswordField label="Password" value="secret" autoComplete="new-password" onChange={vi.fn()} />
      <PasswordField label="Confirm password" value="secret" autoComplete="new-password" onChange={vi.fn()} />
    </>);
    const password = screen.getByLabelText("Password") as HTMLInputElement;
    expect(screen.getByLabelText("Confirm password")).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("type", "password");

    await userEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(password).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
  });
});

const metadata: ReplayMetadata = {
  mapName: "DFH <script>alert(1)</script>",
  matchType: "Ranked & safe",
  blueScore: 2,
  orangeScore: 1,
  duration: 20,
  goals: [{ frame: 1, time: 7, elapsed: 7, playerName: "<b>Alpha</b>", playerTeam: 0 }],
};

function team(id: "blue" | "orange", events = true): TeamAnalysis {
  return {
    id: `${id}-analysis`,
    team: { id, displayName: id === "blue" ? "Blue <unsafe>" : "Orange" },
    players: [{ displayName: id === "blue" ? "Alpha & Co" : "Bravo" }],
    score: { for: id === "blue" ? 2 : 1, against: id === "blue" ? 1 : 2 },
    events: events ? [{
      id: `${id}-event`,
      relation: id === "blue" ? "scored" : "conceded",
      ordinal: 1,
      occurredAtSeconds: 12,
      displayClock: "3:48",
      findings: [
        {
          id: `${id}-nav`, kind: "disagreement", tone: "negative", text: "Safe <model> text at 1-2s",
          subject: { displayName: id === "blue" ? "Alpha" : "Bravo" }, navigation: { anchorSeconds: 12, preRollSeconds: 4.5 },
          extensions: { mistake: {
            expectedFamily: "ENGAGE", actualFamily: "RECOVER", expectedIntent: "PRESSURE", actualIntent: "FAR_ROTATE",
            score: 4.14, sampleCount: 3, window: "1-2s", startTimeSeconds: 12, endTimeSeconds: 12.5,
            confidence: { expected: 0.814, actual: 0.677 }, sustained: true,
          } },
        },
        { id: `${id}-plain`, kind: "informational", tone: "neutral", text: "No navigation finding" },
      ],
    }] : [],
  };
}

describe("loading and errors", () => {
  it("renders loading, processing, and error states", () => {
    const { rerender } = render(<LoadingOverlay loading processing={false} error={null} hasReplay={false} />);
    expect(screen.getByText("Reading replay")).toBeVisible();
    rerender(<LoadingOverlay loading={false} processing error={null} hasReplay={false} />);
    expect(screen.getByText("Analyzing replay")).toBeVisible();
    rerender(<LoadingOverlay loading={false} processing={false} error={{ operation: "load", message: "offline" }} hasReplay={false} />);
    expect(screen.getByRole("alert")).toHaveTextContent("offline");
  });
});

describe("toolbar and upload", () => {
  it("prompts for a replay when none is loaded", () => {
    render(<ReplayToolbar metadata={null} view="2d" processing={false} onUpload={vi.fn()} onViewChange={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Add a replay");
    expect(screen.getByRole("link", { name: "How to use this" })).toHaveAttribute("href", "/guides#replay-review");
  });

  it("renders scoreboard metadata safely and sends view actions", async () => {
    const onViewChange = vi.fn();
    render(<><ReplayToolbar metadata={metadata} view="2d" processing={false} onUpload={vi.fn()} onViewChange={onViewChange} /><Scoreboard metadata={metadata} clock="3:48" overlay /></>);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("DFH <script>alert(1)</script> • Ranked & safe");
    expect(document.querySelector("script")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Match score")).toHaveTextContent("2");
    expect(screen.getByLabelText("Match score")).toHaveClass("replay-scoreboard");
    await userEvent.click(screen.getByRole("button", { name: "3D" }));
    await userEvent.click(screen.getByRole("button", { name: "Auto Cam" }));
    expect(onViewChange).toHaveBeenNthCalledWith(1, "3d");
    expect(onViewChange).toHaveBeenNthCalledWith(2, "autocam");
  });

  it("disables uploads while processing and resets after a rejected upload", async () => {
    const upload = vi.fn(async () => { throw new Error("model failed"); });
    const { rerender } = render(<UploadControl processing onUpload={upload} />);
    expect(screen.getByLabelText("Upload replay")).toBeDisabled();
    rerender(<UploadControl processing={false} onUpload={upload} />);
    const input = screen.getByLabelText("Upload replay") as HTMLInputElement;
    await userEvent.upload(input, new File(["bytes"], "match.replay", { type: "application/octet-stream" }));
    expect(upload).toHaveBeenCalled();
    expect(input.files).toHaveLength(0);
    expect(input).toBeEnabled();
  });

  it("marks all view selections accessibly", () => {
    const { rerender } = render(<ViewSelector view="2d" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "2D" })).toHaveAttribute("aria-pressed", "true");
    rerender(<ViewSelector view="3d" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "3D" })).toHaveAttribute("aria-pressed", "true");
    rerender(<ViewSelector view="autocam" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Auto Cam" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("playback and players", () => {
  it("supports play, pause, scrubbing, and speed changes", async () => {
    const toggle = vi.fn();
    const seek = vi.fn();
    const speed = vi.fn();
    const props = { available: true, playhead: 5, timelineStart: 0, duration: 20, speed: 1, goals: metadata.goals, onToggle: toggle, onSeek: seek, onSpeed: speed };
    const { rerender } = render(<PlaybackControls {...props} playing={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Play replay" }));
    expect(toggle).toHaveBeenCalled();
    rerender(<PlaybackControls {...props} playing />);
    expect(screen.getByRole("button", { name: "Pause replay" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Replay position"), { target: { value: "500" } });
    expect(seek).toHaveBeenCalledWith(10);
    await userEvent.selectOptions(screen.getByLabelText("Playback speed"), "2");
    expect(speed).toHaveBeenCalledWith(2);
  });

  it("selects tracked players", async () => {
    const track = vi.fn();
    const players = [{ key: "0:Alpha", name: "Alpha", team: 0 }];
    render(<PlayerTracker players={players} selected={null} onChange={track} />);
    await userEvent.selectOptions(screen.getByLabelText("Auto track player"), "0:Alpha");
    expect(track).toHaveBeenCalledWith("0:Alpha");
  });

  it("renders live player details", () => {
    render(<PlayerSidebar state={{ frameIndex: 4, ball: { x: 0, y: 0, z: 250 }, cars: [{ id: 1, name: "Alpha", team: 0, x: 0, y: 0, z: 100, yaw: 0, rotation: null }] }} players={[]} trackedPlayerKey={null} onTrackPlayer={vi.fn()} predictionPlayers={[]} projectedCarsEnabled={false} projectedHorizon="0-1" selectedProjectedPlayerIds={[]} onProjectedCarsEnabled={vi.fn()} onProjectedHorizon={vi.fn()} onProjectedPlayers={vi.fn()} />);
    expect(screen.getByText("Alpha")).toBeVisible();
  });

  it("can hide all projection controls while retaining player tracking", () => {
    render(<PlayerSidebar state={{ frameIndex: 0, ball: null, cars: [] }} players={[{ key: "0:Alpha", name: "Alpha", team: 0 }]} trackedPlayerKey={null} onTrackPlayer={vi.fn()} predictionPlayers={[]} projectedCarsEnabled={false} projectedHorizon="0-1" selectedProjectedPlayerIds={[]} onProjectedCarsEnabled={vi.fn()} onProjectedHorizon={vi.fn()} onProjectedPlayers={vi.fn()} showProjections={false} />);
    expect(screen.getByLabelText("Auto track player")).toBeVisible();
    expect(screen.queryByRole("checkbox", { name: "Show projected cars" })).not.toBeInTheDocument();
  });

  it("enables projected cars, changes timeframe, and selects any number of players", async () => {
    const enabled = vi.fn();
    const horizon = vi.fn();
    const players = vi.fn();
    const predictionPlayers = [
      { id: "alpha", displayName: "Alpha", team: "blue" as const, samples: [] },
      { id: "bravo", displayName: "Bravo", team: "orange" as const, samples: [] },
    ];
    const { rerender } = render(<ProjectedCarSettings players={predictionPlayers} enabled={false} horizon="0-1" selectedPlayerIds={["alpha", "bravo"]} onEnabled={enabled} onHorizon={horizon} onPlayers={players} />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Show projected cars" }));
    expect(enabled).toHaveBeenCalledWith(true);

    rerender(<ProjectedCarSettings players={predictionPlayers} enabled horizon="0-1" selectedPlayerIds={["alpha", "bravo"]} onEnabled={enabled} onHorizon={horizon} onPlayers={players} />);
    await userEvent.selectOptions(screen.getByLabelText("Prediction timeframe"), "2-3.5");
    await userEvent.click(screen.getByRole("checkbox", { name: "Alpha" }));
    expect(horizon).toHaveBeenCalledWith("2-3.5");
    expect(players).toHaveBeenCalledWith(["bravo"]);
  });
});

describe("analysis", () => {
  it("selects the losing team's most frequent mistake contributor and calculates fault per goal", () => {
    const losing = team("orange");
    const mistake = losing.events[0].findings[0];
    const bravoSecond = { ...mistake, id: "bravo-second" };
    const other = { ...mistake, id: "other", subject: { displayName: "Charlie" }, text: "Charlie's mistake" };
    losing.events[0].findings = [mistake, bravoSecond, other];
    losing.events.push({
      ...losing.events[0], id: "orange-conceded-2", ordinal: 2,
      findings: [{ ...other, id: "other-second" }],
    });

    const result = calculateWhoThrew([team("blue"), losing]);

    expect(result?.player.displayName).toBe("Bravo");
    expect(result?.mistakeCount).toBe(2);
    expect(result?.goals.map(goal => goal.faultPercent)).toEqual([67, 0]);
    expect(result?.averageFaultPercent).toBe(34);
  });

  it("only renders the thrower's mistakes in focused mode", () => {
    const losing = team("orange");
    const bravo = losing.events[0].findings[0];
    losing.events[0].findings = [
      bravo,
      { ...bravo, id: "bravo-second", text: "Bravo repeated the mistake" },
      { ...bravo, id: "charlie", subject: { displayName: "Charlie" }, text: "Charlie made another mistake" },
    ];

    render(<AnalysisPanel teams={[team("blue"), losing]} processing={false} uploadError={null} mode="who-threw" onNavigate={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Bravo" })).toBeVisible();
    expect(screen.getAllByText("67%")).toHaveLength(2);
    expect(screen.getByText("Bravo repeated the mistake")).toBeVisible();
    expect(screen.queryByText("Charlie made another mistake")).not.toBeInTheDocument();
    expect(screen.queryByText("Blue <unsafe> team")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Auto-switch projection" })).not.toBeInTheDocument();
  });

  it("orders replay mistakes by descending score without mutating the analysis", () => {
    const analysis = team("blue");
    const lowerScore = analysis.events[0].findings[0];
    lowerScore.text = "Lower-score mistake";
    const higherScore = {
      ...lowerScore,
      id: "blue-higher-score",
      text: "Higher-score mistake",
      extensions: { mistake: { ...lowerScore.extensions!.mistake!, score: 8.2 } },
    };
    analysis.events[0].findings = [lowerScore, analysis.events[0].findings[1], higherScore];

    render(<AnalysisPanel teams={[analysis]} processing={false} uploadError={null} onNavigate={vi.fn()} />);

    expect(screen.getAllByRole("button", { name: /score mistake/i }).map(button => button.textContent)).toEqual([
      expect.stringContaining("Higher-score mistake"),
      expect.stringContaining("Lower-score mistake"),
    ]);
    expect(analysis.events[0].findings.map(finding => finding.id)).toEqual(["blue-nav", "blue-plain", "blue-higher-score"]);
  });

  it("renders both teams, factual relations, navigation variants, and fixed mistake context", async () => {
    const navigate = vi.fn();
    render(<AnalysisPanel teams={[team("blue"), team("orange")]} processing={false} uploadError={null} onNavigate={navigate} />);
    expect(screen.getByText("Blue <unsafe> team")).toBeVisible();
    expect(screen.getByText("Orange team")).toBeVisible();
    expect(screen.getByText("Goal scored 1")).toBeVisible();
    expect(screen.getByText("Goal conceded 1")).toBeVisible();
    expect(screen.getAllByText("exact moment")).toHaveLength(2);
    expect(screen.getAllByText("far rotate (recover)")).toHaveLength(2);
    expect(screen.getAllByText("68% confidence")).toHaveLength(2);
    expect(screen.getAllByText("pressure (engage)")).toHaveLength(2);
    expect(screen.getAllByText("81% confidence")).toHaveLength(2);
    expect(screen.getAllByText("No navigation finding")[0].closest("button")).toBeNull();
    await userEvent.click(screen.getAllByRole("button", { name: /Safe <model> text/ })[0]);
    expect(navigate).toHaveBeenCalledWith(12, {
      subject: { displayName: "Alpha" },
      teamId: "blue",
      autoProjection: true,
      autoCamera: false,
      projectedHorizon: "1-2",
    });
    await userEvent.click(screen.getByRole("checkbox", { name: "3 Seconds Before Mistake" }));
    expect(screen.getAllByText("3s context")).toHaveLength(2);
    await userEvent.click(screen.getByRole("checkbox", { name: "Auto-switch projection" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Auto-switch camera" }));
    await userEvent.click(screen.getAllByRole("button", { name: /Safe <model> text/ })[0]);
    expect(navigate).toHaveBeenCalledWith(9, {
      subject: { displayName: "Alpha" },
      teamId: "blue",
      autoProjection: false,
      autoCamera: true,
      projectedHorizon: undefined,
    });
    await userEvent.click(screen.getByRole("button", { name: /Goal scored 1/ }));
    expect(navigate).toHaveBeenCalledWith(12);
    expect(document.querySelector("unsafe")).not.toBeInTheDocument();
  });

  it("recognizes supported prediction windows in finding text", () => {
    expect(predictionHorizonFrom("late challenge; 0-1s, 4 samples")).toBe("0-1");
    expect(predictionHorizonFrom("rotation issue in 1 - 2 seconds")).toBe("1-2");
    expect(predictionHorizonFrom("positioning at 2-3.5s")).toBe("2-3.5");
    expect(predictionHorizonFrom("mistake 3 seconds before goal")).toBeUndefined();
  });

  it("explains and displays a persisted mistake from the replay analysis", async () => {
    const explanation = {
      text: "Keep pressure instead of rotating away.", generatedAt: "2026-08-19T12:00:00.000Z", model: "gpt-5.6", promptVersion: "1",
    };
    const mistakesGateway = {
      getByUsername: vi.fn(),
      explain: vi.fn(async (mistakeId: string) => ({ mistakeId, explanation })),
      getWeaknesses: vi.fn(),
    };
    render(<AnalysisPanel teams={[team("blue")]} processing={false} uploadError={null} replayId="replay-1" mistakesGateway={mistakesGateway} onNavigate={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Explain mistake" }));
    expect(mistakesGateway.explain).toHaveBeenCalledWith("replay-1:blue-nav");
    expect(await screen.findByText(explanation.text)).toBeVisible();
  });

  it("offers explanations for mistakes that are not sustained", () => {
    const analysis = team("blue");
    analysis.events[0].findings[0].extensions!.mistake!.sustained = false;

    render(<AnalysisPanel
      teams={[analysis]}
      processing={false}
      uploadError={null}
      replayId="replay-1"
      mistakesGateway={{ getByUsername: vi.fn(), explain: vi.fn(), getWeaknesses: vi.fn() }}
      onNavigate={vi.fn()}
    />);

    expect(screen.getByRole("button", { name: "Explain mistake" })).toBeVisible();
  });

  it("renders empty events, empty findings, and upload errors", () => {
    const emptyFindings = team("blue");
    emptyFindings.events[0].findings = [];
    const { rerender } = render(<AnalysisPanel teams={[team("orange", false), emptyFindings]} processing={false} uploadError={null} onNavigate={vi.fn()} />);
    expect(screen.getByText("No goals or goal-related findings were reported.")).toBeVisible();
    expect(screen.getByText("No sustained high-confidence finding was reported.")).toBeVisible();
    rerender(<AnalysisPanel teams={[]} processing={false} uploadError="analysis failed" onNavigate={vi.fn()} />);
    expect(screen.getByText("analysis failed")).toHaveClass("error");
  });
});

describe("keyboard shortcuts", () => {
  function Harness({ enabled = true }: { enabled?: boolean }) {
    const [value, setValue] = useState(0);
    useReplayKeyboard({ enabled, togglePlayback: () => setValue(current => current + 1), skip: seconds => setValue(current => current + seconds) });
    return <><output>{value}</output><button type="button">Interactive</button><input aria-label="Interactive input" /></>;
  }

  it("handles shortcuts and ignores interactive targets", () => {
    render(<Harness />);
    fireEvent.keyDown(window, { code: "Space" });
    expect(screen.getByRole("status")).toHaveTextContent("1");
    fireEvent.keyDown(window, { code: "ArrowRight" });
    expect(screen.getByRole("status")).toHaveTextContent("6");
    screen.getByRole("button", { name: "Interactive" }).focus();
    fireEvent.keyDown(screen.getByRole("button", { name: "Interactive" }), { code: "Space" });
    fireEvent.keyDown(screen.getByLabelText("Interactive input"), { code: "ArrowLeft" });
    expect(screen.getByRole("status")).toHaveTextContent("6");
  });
});
