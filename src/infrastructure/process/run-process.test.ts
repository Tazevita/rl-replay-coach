import { describe, expect, it } from "vitest";
import { runProcess } from "./run-process";

describe("runProcess", () => {
  it("terminates a process that exceeds its timeout", async () => {
    await expect(runProcess({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      cwd: process.cwd(),
      timeoutMs: 50,
    })).rejects.toThrow("timed out after 50ms");
  });
});
