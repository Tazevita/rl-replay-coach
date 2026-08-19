import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RrrocketProcessAdapter } from "./rrrocket-process-adapter";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))));

describe("RrrocketProcessAdapter", () => {
  it("cleans parser output when rrrocket emits malformed data", async () => {
    const root = await mkdtemp(join(tmpdir(), "rrrocket-adapter-test-"));
    directories.push(root);
    const adapter = new RrrocketProcessAdapter({
      executable: "rrrocket",
      cwd: "/model",
      temporaryRoot: root,
      run: async request => { await writeFile(request.stdoutPath!, "{}"); return ""; },
    });
    await expect(adapter.parse("/upload.replay")).rejects.toThrow();
    expect(await readdir(root)).toEqual([]);
  });
});
