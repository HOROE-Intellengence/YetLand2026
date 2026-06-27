import { z } from 'zod';

export const OtpRequestSchema = z.object({
  phone: z.string().regex(/^\+?\d{8,15}$/),
});

export const OtpVerifySchema = z.object({
  phone: z.string(),
  code: z.string().regex(/^\d{4,8}$/),
});
