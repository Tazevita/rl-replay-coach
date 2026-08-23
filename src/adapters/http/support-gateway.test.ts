import { describe, expect, it, vi } from "vitest";
import { HttpSupportGateway } from "./support-gateway";

describe("HttpSupportGateway", () => {
  it("posts a validated support request", async () => {
    const request = vi.fn(async () => new Response(null, { status: 204 }));
    const gateway = new HttpSupportGateway(request as typeof fetch);

    await gateway.send({ subject: "Question", message: "Please help." });

    expect(request).toHaveBeenCalledWith("/api/support-requests", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ subject: "Question", message: "Please help." }),
    }));
  });

  it("uses the server error message", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ error: "Try again later." }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    }));
    const gateway = new HttpSupportGateway(request as typeof fetch);

    await expect(gateway.send({ subject: "Question", message: "Please help." })).rejects.toThrow("Try again later.");
  });
});
