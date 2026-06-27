import { z } from 'zod';
import { StructuredMessagePartSchema } from './sidecar';

const StageSchema = z.enum(['daily', 'rise', 'climax', 'after', 'end']);
const BoundarySchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);

const ChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
  cacheControl: z.object({ type: z.literal('ephemeral') }).optional(),
});

export const RecallPayloadSchema = z.object({
  preferences: z.array(z.string()),
  events: z.array(z.object({ date: z.string(), text: z.string(), emotion: z.string().optional() })),
});

export const ChatRequestSchema = z.object({
  characterId: z.string(),
  sessionId: z.string(),
  round: z.number().int().nonnegative(),
  prevStage: StageSchema,
  userBoundary: BoundarySchema,
  text: z.string().min(1),
  history: z.array(ChatMessageSchema),
  recall: RecallPayloadSchema.optional(),
  cutoffWarning: z.boolean().optional(),
});

const requestIdField = { requestId: z.string().optional() };

export const ChatStreamEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('meta'),
    stage: StageSchema,
    boundary: BoundarySchema,
    ifActive: z.boolean().optional(),
    ...requestIdField,
    llmMode: z.string().optional(),
    tokenGuard: z.string().optional(),
    mainProviderId: z.string().optional(),
    mainModel: z.string().optional(),
  }),
  z.object({ kind: z.literal('atmosphere'), temperature: z.number().int().min(1).max(5), ...requestIdField }),
  z.object({ kind: z.literal('chunk'), text: z.string(), sentenceEnd: z.boolean().optional(), glow: z.boolean().optional(), ...requestIdField }),
  z.object({ kind: z.literal('structured'), parts: z.array(StructuredMessagePartSchema), rawText: z.string(), source: z.enum(['sidecar', 'fallback']).optional(), degradeReason: z.string().optional(), ...requestIdField }),
  z.object({ kind: z.literal('achievement'), slug: z.string(), ...requestIdField }),
  z.object({ kind: z.literal('cutoff'), reason: z.enum(['quota', 'cost', 'boundary']), ...requestIdField }),
  z.object({ kind: z.literal('error'), code: z.string(), message: z.string(), ...requestIdField }),
  z.object({ kind: z.literal('done'), ...requestIdField }),
]);

export const TelemetryBatchSchema = z.object({
  events: z.array(z.object({ name: z.string(), ts: z.number(), payload: z.record(z.unknown()).optional() })),
});
