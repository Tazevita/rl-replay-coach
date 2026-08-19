import { z } from "zod";

export const replayParserJobSchema = z.object({
  jobId: z.string().min(1),
  sourceKey: z.string().min(1).endsWith(".replay"),
  outputKey: z.string().min(1).endsWith(".json"),
  analysisOutputKey: z.string().min(1).endsWith(".json"),
});

export type ReplayParserJob = z.infer<typeof replayParserJobSchema>;
