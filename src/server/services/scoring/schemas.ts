import { z } from "zod";

const line = z.string().trim().min(3).max(240);

/** Final, validated shape stored on every lead and returned by the API. */
export const scoreResultSchema = z.object({
  score: z.number().int().min(0).max(100),
  tier: z.enum(["A", "B", "C"]),
  reasons: z.array(line).max(8),
  risks: z.array(line).max(8),
  acquisitionSignals: z.array(line).max(6),
});
export type ScoreResult = z.infer<typeof scoreResultSchema>;

/** What we ask the LLM for, one entry per lead in a batch. */
export const llmAssessmentSchema = z.object({
  id: z.string().min(1),
  score: z.number().min(0).max(100).transform((n) => Math.round(n)),
  reasons: z.array(line).max(6).default([]),
  risks: z.array(line).max(6).default([]),
  acquisitionSignals: z.array(line).max(6).default([]),
});
export type LlmAssessment = z.infer<typeof llmAssessmentSchema>;

export const llmBatchSchema = z.object({ assessments: z.array(llmAssessmentSchema).min(1) });
export type LlmBatch = z.infer<typeof llmBatchSchema>;

export type CachedAssessment = Omit<LlmAssessment, "id">;
