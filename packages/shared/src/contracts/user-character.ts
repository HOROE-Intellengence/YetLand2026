import { HqVoiceProfileIdSchema } from './voice-hq';
// 用户自定义角色卡 —— 结构化输入契约 + 编译纯函数
// ----------------------------------------------------------------------------
// 设计要点（见 docs/superpowers/specs/2026-05-19-character-profile-sections-design.md 的延伸）：
//   · 用户填写的两大板块（世界书 / 角色卡）不新增任何"与 AI 路由"的机制，
//     而是编译进既有的 profileSections（每轮拼进 prompt）+ forbiddenPhrases。
//   · 原始结构化输入单独存 customPayload（给后台看的 JSON 真理源 + 防注入隔离），
//     喂给 AI 的永远是本文件 compileUserCharacter() 产出的、已 sanitize 的派生物。
//   · 触发词本期做"扁平常驻注入"（≤30 条一起拼），不做条件命中。
import { z } from 'zod';
import type { CharacterProfileSection } from '../types/character';
import { VoiceNameSchema } from './voice';

// ── 长度上限（与 admin.ts 的 profileSection 上限对齐：value ≤ 2000）──
const WB_TEXT_MAX = 2000;
const TRIGGER_WORD_MAX = 40;
const TRIGGER_CONTENT_MAX = 500;
const TRIGGER_COUNT_MAX = 30;
const STATE_FIELD_MAX = 200;
const TABOO_ITEM_MAX = 60;
const TABOO_COUNT_MAX = 50;

// ── 世界书板块 ──
export const UserCharacterTriggerSchema = z.object({
  word: z.string().max(TRIGGER_WORD_MAX),
  content: z.string().max(TRIGGER_CONTENT_MAX),
});

export const UserCharacterWorldbookSchema = z.object({
  background: z.string().max(WB_TEXT_MAX).optional(),
  corePrinciples: z.string().max(WB_TEXT_MAX).optional(),
  rules: z.string().max(WB_TEXT_MAX).optional(),
  forbiddenRules: z.string().max(WB_TEXT_MAX).optional(),
  triggers: z.array(UserCharacterTriggerSchema).max(TRIGGER_COUNT_MAX).optional(),
  notes: z.string().max(WB_TEXT_MAX).optional(),
});

// ── 角色卡板块 ──
export const UserCharacterCardBlockSchema = z.object({
  relationshipByUser: z.string().max(WB_TEXT_MAX).optional(),
  relationshipByChar: z.string().max(WB_TEXT_MAX).optional(),
  initialState: z
    .object({
      location: z.string().max(STATE_FIELD_MAX).optional(),
      action: z.string().max(STATE_FIELD_MAX).optional(),
    })
    .optional(),
  tabooExpressions: z.array(z.string().max(TABOO_ITEM_MAX)).max(TABOO_COUNT_MAX).optional(),
});

// ── 创建请求（除角色名外全选填；两步确认 = makePublic + consent）──
export const UserCharacterCreateSchema = z.object({
  name: z.string().min(1).max(40),
  voiceName: VoiceNameSchema.optional(),
  hqVoiceProfileId: HqVoiceProfileIdSchema.optional(),
  worldbook: UserCharacterWorldbookSchema.optional(),
  card: UserCharacterCardBlockSchema.optional(),
  // 第一步确认：是否希望角色卡被公开
  makePublic: z.boolean().optional().default(false),
  // 第二步确认：符合公序良俗（必须为 true 才允许提交）
  consent: z.literal(true),
});

export type UserCharacterTrigger = z.infer<typeof UserCharacterTriggerSchema>;
export type UserCharacterWorldbook = z.infer<typeof UserCharacterWorldbookSchema>;
export type UserCharacterCardBlock = z.infer<typeof UserCharacterCardBlockSchema>;
export type UserCharacterCreate = z.infer<typeof UserCharacterCreateSchema>;

// ── 防注入 sanitize ──
// 关键防线：把每个字段压成"单行内联文本"再拼进 `- 键：值` 结构。
//   · 去控制字符 + 折叠所有空白（含换行）为单空格 → 用户内容无法另起新 bullet /
//     伪造 markdown 标题 / 插入 "system:" 段落来越权改写 system prompt 语义。
//   · 键名由我们固定（用户只控制值），注入面仅剩"值"，压成单行后基本封死。
// 逐字符按 codePoint 过滤控制字符 —— 避免源码里出现裸控制字符 / no-control-regex。
export function sanitizeInline(input: string | undefined, max: number): string {
  if (!input) return '';
  let out = '';
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? ' ' : ch;
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, max);
}

const SECTION_KEYS = {
  background: '背景',
  corePrinciples: '核心原则',
  rules: '规则',
  forbiddenRules: '禁止规则',
  triggers: '触发词',
  notes: '备注',
  relationshipByUser: '你眼中的关系',
  relationshipByChar: 'TA眼中的关系',
  initialState: '初始状态',
} as const;

/**
 * 把用户结构化输入编译成既有的 profileSections + forbiddenPhrases。
 * 纯函数、确定性：空字段被剔除，order 顺序赋值，全部经 sanitizeInline。
 * 聊天管线零改动 —— loader.loadCharacterCard 照旧渲染 profileSections。
 */
export function compileUserCharacter(payload: {
  worldbook?: UserCharacterWorldbook;
  card?: UserCharacterCardBlock;
}): { profileSections: CharacterProfileSection[]; forbiddenPhrases: string[] } {
  const wb = payload.worldbook ?? {};
  const card = payload.card ?? {};
  const sections: CharacterProfileSection[] = [];
  const push = (key: string, raw: string): void => {
    const value = sanitizeInline(raw, WB_TEXT_MAX);
    if (value) sections.push({ key, value, order: sections.length });
  };

  // 世界书
  push(SECTION_KEYS.background, wb.background ?? '');
  push(SECTION_KEYS.corePrinciples, wb.corePrinciples ?? '');
  push(SECTION_KEYS.rules, wb.rules ?? '');
  push(SECTION_KEYS.forbiddenRules, wb.forbiddenRules ?? '');
  const triggerLine = (wb.triggers ?? [])
    .slice(0, TRIGGER_COUNT_MAX)
    .map((t) => {
      const word = sanitizeInline(t.word, TRIGGER_WORD_MAX);
      const content = sanitizeInline(t.content, TRIGGER_CONTENT_MAX);
      if (!word && !content) return '';
      return content ? `${word}→${content}` : word;
    })
    .filter(Boolean)
    .join('；');
  if (triggerLine) sections.push({ key: SECTION_KEYS.triggers, value: triggerLine, order: sections.length });
  push(SECTION_KEYS.notes, wb.notes ?? '');

  // 角色卡
  push(SECTION_KEYS.relationshipByUser, card.relationshipByUser ?? '');
  push(SECTION_KEYS.relationshipByChar, card.relationshipByChar ?? '');
  const loc = sanitizeInline(card.initialState?.location, STATE_FIELD_MAX);
  const act = sanitizeInline(card.initialState?.action, STATE_FIELD_MAX);
  const stateParts: string[] = [];
  if (loc) stateParts.push(`位置：${loc}`);
  if (act) stateParts.push(`动作：${act}`);
  if (stateParts.length) {
    sections.push({ key: SECTION_KEYS.initialState, value: stateParts.join('；'), order: sections.length });
  }

  // 禁忌表达 → forbiddenPhrases（去空去重）
  const seen = new Set<string>();
  const forbiddenPhrases: string[] = [];
  for (const raw of card.tabooExpressions ?? []) {
    const item = sanitizeInline(raw, TABOO_ITEM_MAX);
    if (!item || seen.has(item)) continue;
    seen.add(item);
    forbiddenPhrases.push(item);
    if (forbiddenPhrases.length >= TABOO_COUNT_MAX) break;
  }

  return { profileSections: sections, forbiddenPhrases };
}
