// 直接从 packages/prompts/ 的 yaml/md 加载（绕开 prompts:build）。
// 让本地后台无需任何前置构建步骤即可运行。
//
// BE-101 起，角色卡的运行期数据从 services/characters 取（DB 真理源），
// 这里只剩 strategies / boundaries / system template 三类静态资源仍走文件。
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { charactersService } from '../services/characters';
import { preludeCardsService } from '../services/prelude-cards';

const here = dirname(fileURLToPath(import.meta.url));
// apps/api/src/prompts → ../../../../packages/prompts
const PROMPTS_ROOT = resolve(here, '..', '..', '..', '..', 'packages', 'prompts');

export interface CharacterCardLite {
  id: string;
  name: string;
  rarity: string;
  boundary_default: number;
  description?: string;
  voice?: { pace?: string; formality?: string; forbidden_phrases?: string[] };
  opening_lines?: { first_visit?: string; return_visit?: string };
  style_tags?: string[];
}

let _strategies: Record<string, string> | null = null;
let _boundaries: Record<string, string> | null = null;
let _systemTemplate: string | null = null;

function ensureLoaded(): void {
  if (_strategies && _boundaries && _systemTemplate) return;

  const stratDir = join(PROMPTS_ROOT, 'strategies');
  const bdyDir = join(PROMPTS_ROOT, 'boundaries');
  const tplPath = join(PROMPTS_ROOT, 'system.template.md');

  if (!existsSync(stratDir)) {
    console.warn('[prompts] packages/prompts not found at', PROMPTS_ROOT);
    _strategies = {};
    _boundaries = {};
    _systemTemplate = '{{character_card}}\n\n{{boundary_clause}}\n\n{{stage_strategy}}';
    return;
  }

  _strategies = {};
  for (const f of readdirSync(stratDir)) {
    if (!f.endsWith('.md')) continue;
    _strategies[f.replace(/\.md$/, '')] = readFileSync(join(stratDir, f), 'utf8');
  }

  _boundaries = {};
  for (const f of readdirSync(bdyDir)) {
    if (!f.endsWith('.md')) continue;
    _boundaries[f.replace(/\.md$/, '')] = readFileSync(join(bdyDir, f), 'utf8');
  }

  _systemTemplate = existsSync(tplPath)
    ? readFileSync(tplPath, 'utf8')
    : '{{character_card}}\n\n{{boundary_clause}}\n\n{{stage_strategy}}';
}

/**
 * 装配角色卡进 system prompt — 数据来自 service（DB 真理源），
 * 改 forbidden_phrases / description 后下一轮对话立即生效，无需重启。
 */
export function loadCharacterCard(characterId: string): string {
  const row = charactersService.getRow(characterId);
  if (!row) {
    console.warn(`[prompts] character not found: ${characterId}`);
    return '';
  }
  const profileSections = (row.profileSections ?? [])
    .filter((section) => section.key.trim() && section.value.trim())
    .sort((a, b) => a.order - b.order);
  const sectionBlock = profileSections.length
    ? ['设定细节：', ...profileSections.map((section) => `- ${section.key.trim()}：${section.value.trim()}`)].join('\n')
    : '';
  const forbidden = row.forbiddenPhrases.length
    ? `禁用语：${row.forbiddenPhrases.join('、')}`
    : '';
  return [
    `# 角色 · ${row.name}`,
    row.description ? `\n${row.description}` : '',
    sectionBlock ? `\n${sectionBlock}` : '',
    forbidden ? `\n${forbidden}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function loadPreludeCard(characterId: string, ifActive: boolean): string {
  const card = preludeCardsService.resolveForChat(characterId, ifActive);
  if (!card) return '';
  return [`# 前置提示卡 · ${card.name}`, card.content].join('\n\n');
}

export function loadStrategyForStage(stage: string): string {
  ensureLoaded();
  return _strategies![`stage_${stage}`] ?? '';
}

export function loadBoundaryClause(level: 1 | 2 | 3 | 4 | 5): string {
  ensureLoaded();
  const slug: Record<number, string> = {
    1: 'b1_pure', 2: 'b2_restrained', 3: 'b3_subtle', 4: 'b4_explicit', 5: 'b5_direct',
  };
  return _boundaries![slug[level]!] ?? '';
}

export function getSystemTemplate(): string {
  ensureLoaded();
  return _systemTemplate!;
}

/** 兼容旧调用：从 service 取角色行并转成旧的 lite 视图 */
export function getCharacter(characterId: string): CharacterCardLite | null {
  const row = charactersService.getRow(characterId);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    rarity: row.rarity,
    boundary_default: row.boundaryDefault,
    description: row.description,
    voice: { forbidden_phrases: row.forbiddenPhrases },
    opening_lines: {
      first_visit: row.openingFirstVisit,
      return_visit: row.openingReturnVisit,
    },
    style_tags: row.styleTags,
  };
}
