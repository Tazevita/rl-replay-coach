// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GuidesPage } from "./GuidesPage";

afterEach(cleanup);

describe("GuidesPage", () => {
  it("presents both guide chapters and their destinations", () => {
    const { container } = render(<GuidesPage />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("See the game. Change the next one.");
    expect(container.querySelectorAll(".guide-video-shell")).toHaveLength(2);
    expect(screen.getByTitle("Replay review video guide")).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/wO0YZea9R_Q");
    expect(screen.getByTitle("Player analysis video guide")).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/Bb_fqQll160");

    const replayGuide = document.getElementById("replay-review");
    const playerGuide = document.getElementById("player-analysis");
    expect(replayGuide).not.toBeNull();
    expect(playerGuide).not.toBeNull();
    expect(within(replayGuide!).getByRole("link", { name: /Open replay viewer/ })).toHaveAttribute("href", "/");
    expect(within(playerGuide!).getByRole("link", { name: /Open Player Analysis/ })).toHaveAttribute("href", "/check-player");
  });

  it("links the chapter index to each guide", () => {
    render(<GuidesPage />);

    const index = screen.getByRole("navigation", { name: "Guide chapters" });
    expect(within(index).getByRole("link", { name: "01 Replay review" })).toHaveAttribute("href", "#replay-review");
    expect(within(index).getByRole("link", { name: "02 Player analysis" })).toHaveAttribute("href", "#player-analysis");
  });
});
