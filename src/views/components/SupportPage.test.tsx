// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HttpSupportGateway } from "../../adapters/http/support-gateway";
import { SupportPage } from "./SupportPage";

afterEach(cleanup);

describe("SupportPage", () => {
  it("sends the subject and message while displaying the account email", async () => {
    const gateway = { send: vi.fn(async () => undefined) } as unknown as HttpSupportGateway;
    render(<SupportPage email="player@example.com" gateway={gateway} />);

    expect(screen.getByLabelText("Account email")).toHaveValue("player@example.com");
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Replay will not load" } });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "The viewer remains on the loading screen." } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(gateway.send).toHaveBeenCalledWith({
      subject: "Replay will not load",
      message: "The viewer remains on the loading screen.",
    }));
    expect(await screen.findByText(/Message sent/)).toBeVisible();
    expect(screen.getByLabelText("Subject")).toHaveValue("");
    expect(screen.getByLabelText("Message")).toHaveValue("");
  });

  it("keeps the message and reports a submission error", async () => {
    const gateway = { send: vi.fn(async () => { throw new Error("Support is unavailable."); }) } as unknown as HttpSupportGateway;
    render(<SupportPage email="player@example.com" gateway={gateway} />);

    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Question" } });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Please help." } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Support is unavailable.");
    expect(screen.getByLabelText("Message")).toHaveValue("Please help.");
  });
});
