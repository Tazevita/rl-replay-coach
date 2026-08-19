import { z } from "zod";

const vectorSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
});

export const mistakeReplayContextSchema = z.object({
  sampleIntervalSeconds: z.literal(0.25),
  startSeconds: z.number().finite().nonnegative(),
  endSeconds: z.number().finite().nonnegative(),
  goalBoundarySeconds: z.number().finite().nonnegative().nullable(),
  samples: z.array(z.object({
    timeSeconds: z.number().finite().nonnegative(),
    ball: vectorSchema.nullable(),
    players: z.array(z.object({
      actorId: z.number().int(),
      displayName: z.string().min(1),
      team: z.enum(["blue", "orange"]),
      position: vectorSchema,
      yaw: z.number().finite(),
      rotation: vectorSchema.extend({ w: z.number().finite() }).nullable(),
    })),
  })),
});

export const mistakeExplanationSchema = z.object({
  text: z.string().trim().min(1).max(500),
  generatedAt: z.string().datetime(),
  model: z.string().min(1),
  promptVersion: z.string().min(1),
});

export const playerMistakeSchema = z.object({
  id: z.string().min(1),
  replayId: z.string().min(1),
  replayFilename: z.string().min(1),
  playerId: z.string().min(1),
  displayName: z.string().min(1),
  eventId: z.string().min(1),
  occurredAtSeconds: z.number().finite().nonnegative(),
  anchorSeconds: z.number().finite().nonnegative(),
  expectedFamily: z.string().min(1),
  actualFamily: z.string().min(1),
  expectedIntent: z.string().min(1),
  actualIntent: z.string().min(1),
  score: z.number().finite().nonnegative(),
  sampleCount: z.number().int().positive(),
  window: z.string().min(1),
  text: z.string().min(1),
  analyzedAt: z.string().datetime(),
  replayContext: mistakeReplayContextSchema.nullable().optional(),
  explanation: mistakeExplanationSchema.nullable(),
});

export const mistakeExplanationResponseSchema = z.object({
  mistakeId: z.string().min(1),
  explanation: mistakeExplanationSchema,
});

export const playerWeaknessesContentSchema = z.object({
  weaknesses: z.array(z.object({
    weakness: z.string().trim().min(1).max(48).regex(/^[\x20-\x7E]+$/),
    pattern: z.string().trim().min(1).max(600).regex(/^[\x20-\x7E]+$/),
    workOn: z.string().trim().min(1).max(500).regex(/^[\x20-\x7E]+$/),
    remember: z.string().trim().min(1).max(220).regex(/^[\x20-\x7E]+$/),
  })).min(1).max(3),
});

export const playerWeaknessesResponseSchema = playerWeaknessesContentSchema.extend({
  username: z.string().min(1),
  generatedAt: z.string().datetime(),
  model: z.string().min(1),
  promptVersion: z.string().min(1),
});

export const playerMistakesResponseSchema = z.object({
  username: z.string(),
  createdBy: z.string().min(1),
  playerIds: z.array(z.string().min(1)),
  replayCount: z.number().int().nonnegative(),
  totalMistakes: z.number().int().nonnegative(),
  tacticalFocus: z.array(z.object({
    expectedFamily: z.string().min(1),
    actualFamily: z.string().min(1),
    count: z.number().int().positive(),
    averageScore: z.number().finite().nonnegative(),
  })),
  decisionHabits: z.array(z.object({
    expectedIntent: z.string().min(1),
    actualIntent: z.string().min(1),
    count: z.number().int().positive(),
    averageScore: z.number().finite().nonnegative(),
  })),
  mistakes: z.array(playerMistakeSchema),
});

export type PlayerMistakesResponse = z.infer<typeof playerMistakesResponseSchema>;
export type PlayerMistake = z.infer<typeof playerMistakeSchema>;
export type MistakeReplayContext = z.infer<typeof mistakeReplayContextSchema>;
export type MistakeExplanation = z.infer<typeof mistakeExplanationSchema>;
export type MistakeExplanationResponse = z.infer<typeof mistakeExplanationResponseSchema>;
export type PlayerWeaknessesContent = z.infer<typeof playerWeaknessesContentSchema>;
export type PlayerWeaknessesResponse = z.infer<typeof playerWeaknessesResponseSchema>;
