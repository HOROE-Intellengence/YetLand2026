import { z } from 'zod';
import { PhoneRoleRulesSchema } from './phone';

/** Community packages deliberately contain data, never executable CSS or remote URLs. */
export const CommunityWorldbookSchema = z
  .object({
    schema: z.literal('yelan-worldbook'),
    schemaVersion: z.literal(1),
    entries: PhoneRoleRulesSchema.shape.worldBook.refine(
      (rows) => rows.length > 0,
      '世界书不能为空',
    ),
  })
  .strict();

export const COMMUNITY_THEME_COLORS = [
  '--c-header-bg',
  '--c-page-body-bg',
  '--c-card',
  '--c-card-border',
  '--c-polaroid',
  '--c-polaroid-back',
  '--c-panel',
  '--c-panel-border',
  '--c-text-title',
  '--c-text',
  '--c-icon-active',
  '--c-icon',
  '--c-input',
  '--c-input-border',
  '--c-bubble-self',
  '--c-bubble-other',
  '--c-success',
  '--c-danger',
  '--c-warning',
  '--ctx-menu-bg',
] as const;
const color = z
  .string()
  .regex(/^#[\da-fA-F]{6}(?:[\da-fA-F]{2})?$/, '颜色请使用 #RRGGBB 或 #RRGGBBAA');
export const CommunityThemeSchema = z
  .object({
    schema: z.literal('yelan-phone-theme'),
    schemaVersion: z.literal(1),
    name: z.string().trim().min(1).max(60),
    cssOverrides: z.record(z.enum(COMMUNITY_THEME_COLORS), color).default({}),
    fontFamily: z.enum(['system', 'serif', 'monospace']).default('system'),
    wallpaper: z
      .object({
        dataUrl: z
          .string()
          .max(80000)
          .regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/),
        blur: z.number().min(0).max(24).default(0),
        opacity: z.number().min(0).max(1).default(0.9),
        scale: z.number().min(10).max(200).default(100),
        x: z.number().min(0).max(100).default(50),
        y: z.number().min(0).max(100).default(50),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((p) => Object.keys(p.cssOverrides).length > 0 || !!p.wallpaper, '主题需要配色或壁纸');
export type CommunityWorldbook = z.infer<typeof CommunityWorldbookSchema>;
export type CommunityTheme = z.infer<typeof CommunityThemeSchema>;
export type CommunityThemeState = {
  revision: string;
  installationId: string | null;
  theme: CommunityTheme | null;
};
