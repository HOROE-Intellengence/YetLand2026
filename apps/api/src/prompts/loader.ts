// 直接从 packages/prompts/ 的 yaml/md 加载（绕开 prompts:build）。
// 让本地后台无需任何前置构建步骤即可运行。
//
// BE-101 起，角色卡的运行期数据从 services/characters 取（DB 真理源），
// 这里只剩 strategies / boundaries / system template 三类静态资源仍走文件。
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { charactersService, normalizeProfileSections } from '../services/characters';
import { preludeCardsService } from '../services/prelude-cards';
import { store } from '../store/persistence';

const here = dirname(fileURLToPath(import.meta.url));
// apps/api/src/prompts → ../../../../packages/prompts
const PROMPTS_ROOT = resolve(here, '..', '..', '..', '..', 'packages', 'prompts');

/**
 * 灰度覆盖：返回某个 prompt key 当前「生效中」（activeAt 非空）的灰度版本值，
 * 没有则返回 null。key 命名与 routes/admin/prompts.ts 的 listPromptSources 对齐：
 *   system:template / boundary:<slug> / strategy:<slug> / system:cutoff_warning
 *
 * 设计要点：
 * - 直接读 store.state()（live 真理源），不进 ensureLoaded 的文件缓存，
 *   所以后台发布/回滚灰度版本后「下一轮对话」即生效，无需重载文件缓存。
 * - 空串也算有效覆盖（管理员可能有意清空某段），故用 != null 判断而非真值判断。
 */
function getActiveVersion(key: string): string | null {
  const v = store.state().prompts?.versions?.find((ver) => ver.key === key && ver.activeAt);
  return v ? v.value : null;
}

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
  const profileSections = normalizeProfileSections(row.profileSections);
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
  // 灰度覆盖优先，缺省回退磁盘文件。
  return getActiveVersion(`strategy:stage_${stage}`) ?? _strategies![`stage_${stage}`] ?? '';
}

const BOUNDARY_SLUG: Record<number, string> = {
  1: 'b1_pure', 2: 'b2_restrained', 3: 'b3_subtle', 4: 'b4_explicit', 5: 'b5_direct',
};

export function loadBoundaryClause(level: 1 | 2 | 3 | 4 | 5): string {
  ensureLoaded();
  const slug = BOUNDARY_SLUG[level]!;
  // 灰度覆盖优先，缺省回退磁盘文件。
  return getActiveVersion(`boundary:${slug}`) ?? _boundaries![slug] ?? '';
}

export function getSystemTemplate(): string {
  ensureLoaded();
  // 灰度覆盖优先，缺省回退磁盘文件。
  return getActiveVersion('system:template') ?? _systemTemplate!;
}

/**
 * 清空文件类提示资产缓存（system template / strategies / boundaries）。
 * 配置重载后调用，让下次 ensureLoaded() 重新 readFileSync，无需重启进程。
 * 懒加载：本函数只置空，实际重读发生在下一次用到时，不增加重载耗时。
 */
export function resetPromptCache(): void {
  _strategies = null;
  _boundaries = null;
  _systemTemplate = null;
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
