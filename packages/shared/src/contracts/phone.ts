import { z } from 'zod';

const regexText = z.string().min(1).max(500).refine(value => {
  try { new RegExp(value); return true; } catch { return false; }
}, '正则表达式语法错误');

export const PhoneRoleRulesSchema = z.object({
  preset: z.string().max(12000).default(''),
  worldBook: z.array(z.object({
    key: z.string().max(500), content: z.string().min(1).max(6000),
    constant: z.boolean().default(false), useRegex: z.boolean().default(false),
    position: z.enum(['before_char', 'after_char']).default('after_char'),
  }).superRefine((row, ctx) => {
    if (!row.constant && !row.key.trim()) ctx.addIssue({ code: 'custom', path: ['key'], message: '请填写触发词或启用常驻' });
    if (row.useRegex && !regexText.safeParse(row.key).success) ctx.addIssue({ code: 'custom', path: ['key'], message: '世界书正则语法错误' });
  })).max(100).default([]),
  regexes: z.array(z.object({
    name: z.string().max(100).default('文本规则'),
    pattern: regexText,
    replacement: z.string().max(4000),
    target: z.enum(['input', 'output']).default('output'),
    disabled: z.boolean().default(false),
  })).max(50).default([]),
}).strict();
export type PhoneRoleRules = z.infer<typeof PhoneRoleRulesSchema>;
