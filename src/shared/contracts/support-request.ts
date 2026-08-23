import { z } from "zod";

export const supportRequestSchema = z.object({
  subject: z.string().trim().min(1, "Enter a subject.").max(120, "Subject must be 120 characters or fewer."),
  message: z.string().trim().min(1, "Enter a message.").max(5000, "Message must be 5,000 characters or fewer."),
}).strict();

export type SupportRequest = z.infer<typeof supportRequestSchema>;
