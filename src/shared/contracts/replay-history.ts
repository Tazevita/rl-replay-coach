import { z } from "zod";

export const replayHistoryItemSchema = z.object({
  id: z.string().min(1),
  filename: z.string().min(1),
  analyzedAt: z.string().datetime(),
});

export const replayHistorySchema = z.array(replayHistoryItemSchema);

export type ReplayHistoryItem = z.infer<typeof replayHistoryItemSchema>;
