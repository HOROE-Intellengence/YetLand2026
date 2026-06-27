import { z } from 'zod';

export const SurveySubmissionSchema = z.object({
  answers: z.array(z.object({
    questionId: z.string(),
    answer: z.unknown(),
    dwellMs: z.number().int().nonnegative(),
  })).min(1),
});
