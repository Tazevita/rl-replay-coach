import type { ReplayJobRepository, ReplaySource } from "./ports";
import type { ProcessReplay } from "./process-replay";
import type { ReplayJob } from "../shared/contracts/replay-job";

export interface ProcessReplayJobDependencies {
  processReplay: Pick<ProcessReplay, "execute">;
  jobs: ReplayJobRepository;
  createId(): string;
  now(): Date;
}

export class ProcessReplayJob {
  constructor(private readonly dependencies: ProcessReplayJobDependencies) {}

  async submit(source: ReplaySource): Promise<string> {
    const id = this.dependencies.createId();
    await this.dependencies.jobs.create({
      id,
      createdBy: source.createdBy,
      createdAt: this.dependencies.now().toISOString(),
    });
    void this.run(id, source);
    return id;
  }

  get(id: string, createdBy: string): Promise<ReplayJob | undefined> {
    return this.dependencies.jobs.get(id, createdBy);
  }

  private async run(id: string, source: ReplaySource): Promise<void> {
    try {
      await this.dependencies.jobs.setStatus(id, source.createdBy, "processing", this.dependencies.now().toISOString());
      const result = await this.dependencies.processReplay.execute(source);
      await this.dependencies.jobs.complete(id, source.createdBy, result, this.dependencies.now().toISOString());
    } catch (error) {
      await source.dispose().catch(() => undefined);
      const message = error instanceof Error ? error.message : "Replay processing failed.";
      try {
        await this.dependencies.jobs.fail(id, source.createdBy, message, this.dependencies.now().toISOString());
      } catch (persistenceError) {
        console.error("Could not persist replay job failure.", persistenceError);
      }
    }
  }
}
