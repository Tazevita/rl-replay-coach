// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { HttpReplayHistoryGateway } from "../../adapters/http/replay-history-gateway";
import { ReplayHistoryPage } from "./ReplayHistoryPage";

describe("ReplayHistoryPage", () => {
  it("opens saved replays and removes a replay after confirmation", async () => {
    const gateway = {
      list: vi.fn(async () => [{ id: "replay-1", filename: "ranked.replay", analyzedAt: "2026-08-19T12:00:00.000Z" }]),
      delete: vi.fn(async () => undefined),
    } as unknown as HttpReplayHistoryGateway;
    render(<ReplayHistoryPage gateway={gateway} />);

    const link = await screen.findByRole("link", { name: /ranked\.replay/i });
    expect(link).toHaveAttribute("href", "/?replay=replay-1");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText("Delete permanently?")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));

    await waitFor(() => expect(gateway.delete).toHaveBeenCalledWith("replay-1"));
    expect(await screen.findByText("No saved replays")).toBeVisible();
  });
});
