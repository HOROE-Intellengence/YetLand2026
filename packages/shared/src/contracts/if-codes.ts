import { z } from 'zod';

// ── Request ──
export const IfCodesRedeemSchema = z.object({
  code: z.string().min(1),
});

// ── Response ──
export const IfCodesRedeemResponseSchema = z.object({
  accepted: z.literal(true),
});

export type IfCodesRedeem = z.infer<typeof IfCodesRedeemSchema>;
export type IfCodesRedeemResponse = z.infer<typeof IfCodesRedeemResponseSchema>;
