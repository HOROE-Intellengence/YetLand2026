import type { HqVoiceProfileId } from '../contracts/voice-hq';
import type { Boundary } from '../enums/boundary';
import type { Constellation } from './constellation';
import type { VoiceName } from '../contracts/voice';

export type CharacterRarity = 'free' | 'paid' | 'hidden';

export interface CharacterOpeningLines {
  firstVisit: string;
  returnVisit: string;
}

export interface CharacterProfileSection {
  key: string;
  value: string;
  order: number;
}

export interface Character {
  id: string;
  slug: string;
  name: string;
  rarity: CharacterRarity;
  priceCandle: number;
  styleTags: string[];
  promptCardKey?: string;
  preludeCardId?: string | null;
  voiceName?: VoiceName;
  hqVoiceProfileId?: HqVoiceProfileId;
  boundaryDefault: Boundary;
  isActive: boolean;
  openingLines: CharacterOpeningLines;
  /** 角色背景描述；进 system prompt 的 # 角色 块 */
  description?: string;
  /** 装配 system prompt 时的"禁用语"清单 */
  forbiddenPhrases?: string[];
  /** 上次更新（运营改字段后立即变；前端用于无重启验证） */
  updatedAt?: string;
  /** 介绍页星座叠加层数据；独立存储，读公共角色列表时 join 进来，缺省回退内置默认。 */
  constellation?: Constellation;
}
