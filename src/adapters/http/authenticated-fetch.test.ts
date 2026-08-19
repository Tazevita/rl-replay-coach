import { afterEach, describe, expect, it, vi } from "vitest";
import { authenticatedFetch } from "./authenticated-fetch";

describe("authenticatedFetch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads the latest access token for every request", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response());
    vi.stubGlobal("fetch", fetch);
    let token = "first-token";
    const request = authenticatedFetch(() => token);

    await request("/api/replays");
    token = "refreshed-token";
    await request("/api/replays");

    expect(fetch.mock.calls[0][1].headers.get("Authorization")).toBe("Bearer first-token");
    expect(fetch.mock.calls[1][1].headers.get("Authorization")).toBe("Bearer refreshed-token");
  });
});
