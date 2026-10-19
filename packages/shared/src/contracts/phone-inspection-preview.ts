import { z } from 'zod';

export { INSPECTION_ASSET_LIMIT, INSPECTION_IMAGE_INPUT_LIMIT, INSPECTION_ASSET_MIME } from '../utils/phone-inspection-assets';
const previewShape = z.object({
  version: z.literal(1),
  type: z.enum(['document', 'conversation', 'vn', 'app', 'game', 'feed', 'shopping', 'profile']),
  data: z.record(z.unknown()),
  assets: z.array(z.object({
    ref: z.string().max(500), id: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    mime: z.string().max(100).optional(), state: z.enum(['stored', 'missing', 'too-large']),
    name: z.string().max(240).optional(), source: z.enum(['user-upload','phone-inspection','archive']).optional(),
  }).strict()).max(10000).default([]),
  partial: z.boolean().default(false),
}).strict();
export const PhoneInspectionPreviewSchema = previewShape.refine(value => value.assets.length <= 120 && JSON.stringify(value).length <= 2_600_000, '预览内容过大');
export const PhoneInspectionArchiveSchema = previewShape.refine(value => JSON.stringify(value).length <= 64_000_000, '完整预览内容过大');
export type PhoneInspectionPreview = z.infer<typeof PhoneInspectionPreviewSchema>;

export const PhoneCallTraceSchema = z.object({
  sourceApp: z.string().trim().min(1).max(100),
  sessionId: z.string().max(200).optional(),
  operation: z.string().max(100).optional(),
  turnId: z.string().max(200).optional(),
}).strict();
export type PhoneCallTrace = z.infer<typeof PhoneCallTraceSchema>;
