// 侧袋 AI 共享类型
// 5 个侧袋 AI 的输入输出类型定义
import type { Stage } from '../enums/stage';
import type { Boundary } from '../enums/boundary';

// ── 结构拆句 AI ──
export type MessagePartType = 'dialogue' | 'action' | 'environment' | 'narration';

export interface StructuredMessagePart {
  type: MessagePartType;
  text: string;
}

export interface OutputStructurerResult {
  parts: StructuredMessagePart[];
}

// ── 氛围判断 AI ──
export interface AtmosphereInput {
  characterName: string;
  characterPersonality: string;
  boundary: Boundary;
  stage: Stage;
  round: number;
  ifActive: boolean;
  recentTemperatures: number[];
  recentConversation: string;
  userInput: string;
  /** 角色的升温规则描述，如"慢热、克制、需要明显主动信号才升温" */
  warmingRule?: string;
  /** 当日升温暗号是否命中 */
  codeMatched?: boolean;
  /** 温度上限；保留给后续运营策略。 */
  maxTemperature?: number;
}

export interface AtmosphereResult {
  temperature: number; // 1-5
}

// ── 偏好记录 AI ──
export type PreferenceCategory = 'address' | 'boundary' | 'preference' | 'fact' | 'relationship' | 'other';

export interface PreferenceRecordPreference {
  text: string;
  category?: string;
}

export interface PreferenceRecordResult {
  preferences: Array<string | PreferenceRecordPreference>;
  events: { date: string; text: string; emotion?: string }[];
  relationshipState?: string;
  summary: string; // 用户画像摘要，Markdown
}

// ── 额度结束 AI ──
export interface QuotaEndingResult {
  closingInstruction: string;
}

// ── 上下文压缩 AI ──
export interface ContextCompressResult {
  summary: string; // 旧对话概要，Markdown
}

// ── 侧袋 Prompt Key ──
export type SidecarPromptKey =
  | 'preferenceRecorder'
  | 'outputStructurer'
  | 'atmosphereJudge'
  | 'quotaEnding'
  | 'contextCompressor';

export interface SidecarPromptsMap {
  preferenceRecorder: string;
  outputStructurer: string;
  atmosphereJudge: string;
  quotaEnding: string;
  contextCompressor: string;
}
