import { z } from "zod";

const frameSchema = z.object({
  time: z.number().finite(),
  new_actors: z.array(z.unknown()),
  updated_actors: z.array(z.unknown()),
  deleted_actors: z.array(z.unknown()),
}).passthrough();

export const rrrocketReplaySchema = z.object({
  properties: z.record(z.string(), z.unknown()),
  objects: z.array(z.string()),
  names: z.array(z.string()),
  network_frames: z.object({
    frames: z.array(frameSchema).min(1),
  }).passthrough(),
}).passthrough();

export type RrrocketReplay = z.infer<typeof rrrocketReplaySchema>;
