import { z } from 'zod';

export const ApiErrorCodeSchema = z.enum([
  'NOT_FOUND',
  'AUTH_REQUIRED',
  'AUTH_INVALID',
  'ADMIN_AUTH_REQUIRED',
  'INSUFFICIENT_CANDLE',
  'VALIDATION_ERROR',
  'INTERNAL_ERROR',
]);

export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
