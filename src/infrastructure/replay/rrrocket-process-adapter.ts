import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ParsedReplay, ReplayParser } from "../../application/ports";
import { rrrocketReplaySchema } from "../../shared/contracts/rrrocket";
import { runProcess, type ProcessRunner } from "../process/run-process";

export interface RrrocketProcessAdapterOptions {
  executable: string;
  cwd: string;
  run?: ProcessRunner;
  temporaryRoot?: string;
}

export class RrrocketProcessAdapter implements ReplayParser {
  constructor(private readonly options: RrrocketProcessAdapterOptions) {}

  async parse(sourcePath: string): Promise<ParsedReplay> {
    const directory = await mkdtemp(join(this.options.temporaryRoot ?? tmpdir(), "replay-parser-"));
    const outputPath = join(directory, "replay.json");
    try {
      await (this.options.run ?? runProcess)({
        command: this.options.executable,
        args: ["--network-parse", sourcePath],
        cwd: this.options.cwd,
        stdoutPath: outputPath,
      });
      const data = rrrocketReplaySchema.parse(JSON.parse(await readFile(outputPath, "utf8")));
      return {
        data,
        analysisInputPath: outputPath,
        dispose: () => rm(directory, { recursive: true, force: true }),
      };
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }
}
