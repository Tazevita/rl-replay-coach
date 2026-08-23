import type { ReplayRepository } from "./ports";

export const MAX_REPLAYS_PER_USER = 50;
export const REPLAY_LIMIT_MESSAGE = `You can store up to ${MAX_REPLAYS_PER_USER} replays. Delete a replay before uploading another.`;

export class ReplayLimitReachedError extends Error {
  constructor() {
    super(REPLAY_LIMIT_MESSAGE);
    this.name = "ReplayLimitReachedError";
  }
}

export async function assertReplayCapacity(repository: Pick<ReplayRepository, "listReplays">, createdBy: string): Promise<void> {
  if ((await repository.listReplays(createdBy)).length >= MAX_REPLAYS_PER_USER) {
    throw new ReplayLimitReachedError();
  }
}
