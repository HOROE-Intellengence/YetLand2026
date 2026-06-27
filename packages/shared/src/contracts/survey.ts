import { z } from 'zod';

// 重导出 schemas/survey.ts
export { SurveySubmissionSchema } from '../schemas/survey';

const SurveyQuestionSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['single', 'multi', 'text', 'scale']),
  title: z.string().min(1),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  minSeconds: z.number().int().min(0),
});

export const SurveyFeedbackSchema = z.object({
  text: z.string().trim().min(1).max(5000),
  characterId: z.string().optional(),
  source: z.string().optional(),
});

export const AdminSurveyCreateSchema = z.object({
  id: z.string().min(1).max(80).regex(/^[a-z0-9_-]+$/).optional(),
  title: z.string().min(1),
  rewardCandle: z.number().int().min(0),
  status: z.enum(['active', 'inactive']).optional(),
  questions: z.array(SurveyQuestionSchema).optional(),
  reason: z.string().min(1),
});

export const AdminSurveyPatchSchema = AdminSurveyCreateSchema.partial().extend({
  reason: z.string().min(1),
});

export const AdminSurveyToggleSchema = z.object({
  reason: z.string().min(1).optional(),
});

export type SurveyFeedback = z.infer<typeof SurveyFeedbackSchema>;
export type AdminSurveyCreate = z.infer<typeof AdminSurveyCreateSchema>;
export type AdminSurveyPatch = z.infer<typeof AdminSurveyPatchSchema>;
export type AdminSurveyToggle = z.infer<typeof AdminSurveyToggleSchema>;
