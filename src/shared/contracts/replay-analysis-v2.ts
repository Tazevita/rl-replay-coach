import { z } from "zod";

const identifier = z.string().min(1);
const seconds = z.number().finite().nonnegative();

const mistakeMetadataSchema = z.object({
  expectedFamily: identifier,
  actualFamily: identifier,
  expectedIntent: identifier,
  actualIntent: identifier,
  score: z.number().finite().nonnegative(),
  sampleCount: z.number().int().positive(),
  window: identifier,
  startTimeSeconds: seconds,
  endTimeSeconds: seconds,
  confidence: z.object({
    expected: z.number().finite().min(0).max(1),
    actual: z.number().finite().min(0).max(1),
  }),
  sustained: z.boolean(),
});

export const analysisFindingSchema = z.object({
  id: identifier,
  kind: z.enum(["contribution", "alignment", "disagreement", "warning", "informational"]),
  tone: z.enum(["positive", "negative", "neutral", "warning"]),
  text: z.string().min(1),
  subject: z.object({
    playerId: identifier.optional(),
    displayName: z.string().min(1),
  }).optional(),
  navigation: z.object({
    anchorSeconds: seconds,
    preRollSeconds: seconds,
  }).optional(),
  evidence: z.record(z.string(), z.unknown()).optional(),
  extensions: z.object({
    mistake: mistakeMetadataSchema.optional(),
  }).catchall(z.unknown()).optional(),
});

export const analysisEventSchema = z.object({
  id: identifier,
  relation: z.enum(["scored", "conceded"]),
  ordinal: z.number().int().positive(),
  occurredAtSeconds: seconds,
  displayClock: z.string().min(1).optional(),
  findings: z.array(analysisFindingSchema),
});

export const teamAnalysisSchema = z.object({
  id: identifier,
  team: z.object({
    id: z.enum(["blue", "orange"]),
    displayName: z.string().min(1),
  }),
  players: z.array(z.object({
    id: identifier.optional(),
    displayName: z.string().min(1),
  })),
  score: z.object({
    for: z.number().int().nonnegative(),
    against: z.number().int().nonnegative(),
  }),
  events: z.array(analysisEventSchema),
});

export const predictionVectorSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
});

export const predictionWindowSchema = z.object({
  startSeconds: seconds,
  endSeconds: seconds,
});

export const playerPredictionHorizonSchema = z.object({
  window: predictionWindowSchema,
  targetSeconds: seconds,
  position: predictionVectorSchema,
  forward: predictionVectorSchema,
});

export const playerPredictionSampleSchema = z.object({
  anchorSeconds: seconds,
  status: z.enum(["available", "unavailable"]),
  horizons: z.array(playerPredictionHorizonSchema),
}).superRefine((sample, context) => {
  if (sample.status === "unavailable" && sample.horizons.length) {
    context.addIssue({ code: "custom", path: ["horizons"], message: "Unavailable samples cannot contain prediction horizons." });
  }
});

export const playerPredictionSchema = z.object({
  id: identifier,
  displayName: z.string().min(1),
  team: z.enum(["blue", "orange"]),
  samples: z.array(playerPredictionSampleSchema),
});

export const playerPredictionsSchema = z.object({
  sampleIntervalSeconds: z.number().finite().positive(),
  players: z.array(playerPredictionSchema),
});

export const replayAnalysisBundleV2Schema = z.object({
  schemaVersion: z.literal(2),
  replay: z.object({
    id: identifier,
    filename: z.string().min(1),
    dataUrl: z.string().min(1),
    timebase: z.object({
      unit: z.literal("seconds"),
      origin: z.literal("replay-start"),
    }),
  }),
  analysis: z.object({
    provider: z.string().min(1),
    modelVersion: z.string().min(1).optional(),
    generatedAt: z.string().datetime(),
    teams: z.array(teamAnalysisSchema).min(1),
    playerPredictions: playerPredictionsSchema,
  }),
});

export type AnalysisFinding = z.infer<typeof analysisFindingSchema>;
export type AnalysisEvent = z.infer<typeof analysisEventSchema>;
export type TeamAnalysis = z.infer<typeof teamAnalysisSchema>;
export type PredictionVector = z.infer<typeof predictionVectorSchema>;
export type PredictionWindow = z.infer<typeof predictionWindowSchema>;
export type PlayerPredictionHorizon = z.infer<typeof playerPredictionHorizonSchema>;
export type PlayerPredictionSample = z.infer<typeof playerPredictionSampleSchema>;
export type PlayerPrediction = z.infer<typeof playerPredictionSchema>;
export type PlayerPredictions = z.infer<typeof playerPredictionsSchema>;
export type ReplayAnalysisBundleV2 = z.infer<typeof replayAnalysisBundleV2Schema>;
