// Prompt 灰度版本管理（mock：本地落 store.state().prompts.versions）
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AdminPromptReleaseSchema, AdminPromptRollbackSchema } from '@yelan/shared';
import { store } from '../../store/persistence';
import { charactersService } from '../../services/characters';
import { loadCharacterCard } from '../../prompts/loader';
import { audit } from './_audit';
import { validationHook } from '../../middleware/validation';

export const adminPromptsRoute = new Hono();

const here = dirname(fileURLToPath(import.meta.url));
const PROMPTS_ROOT = resolve(here, '..', '..', '..', '..', '..', 'packages', 'prompts');

type PromptSource = {
  key: string;
  kind: 'boundary' | 'strategy' | 'character' | 'system';
  label: string;
  value: string;
  activeVersionId: string | null;
  activeValue: string | null;
  updatedAt: string | null;
};

const boundaryLabels: Record<string, string> = {
  b1_pure: '破甲 B1 / 纯净',
  b2_restrained: '破甲 B2 / 克制',
  b3_subtle: '破甲 B3 / 暧昧',
  b4_explicit: '破甲 B4 / 露骨',
  b5_direct: '破甲 B5 / 直白',
};

function readPromptFile(...parts: string[]): string {
  const filePath = join(PROMPTS_ROOT, ...parts);
  return existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
}

function activeVersionFor(key: string) {
  return store.state().prompts.versions.find((v) => v.key === key && v.activeAt);
}

function withActive(source: Omit<PromptSource, 'activeVersionId' | 'activeValue' | 'updatedAt'>): PromptSource {
  const active = activeVersionFor(source.key);
  return {
    ...source,
    activeVersionId: active?.id ?? null,
    activeValue: active?.value ?? null,
    updatedAt: active?.activeAt ?? null,
  };
}

function listPromptSources(): PromptSource[] {
  const sources: PromptSource[] = [];

  const systemTemplate = readPromptFile('system.template.md');
  if (systemTemplate) {
    sources.push(withActive({
      key: 'system:template',
      kind: 'system',
      label: '系统模板',
      value: systemTemplate,
    }));
  }

  const boundaryDir = join(PROMPTS_ROOT, 'boundaries');
  if (existsSync(boundaryDir)) {
    const files = readdirSync(boundaryDir).filter((f) => f.endsWith('.md')).sort();
    for (const file of files) {
      const slug = file.replace(/\.md$/, '');
      sources.push(withActive({
        key: `boundary:${slug}`,
        kind: 'boundary',
        label: boundaryLabels[slug] ?? `破甲 ${slug}`,
        value: readPromptFile('boundaries', file),
      }));
    }
  }

  const strategyDir = join(PROMPTS_ROOT, 'strategies');
  if (existsSync(strategyDir)) {
    const files = readdirSync(strategyDir).filter((f) => f.endsWith('.md')).sort();
    for (const file of files) {
      const slug = file.replace(/\.md$/, '');
      sources.push(withActive({
        key: `strategy:${slug}`,
        kind: 'strategy',
        label: `阶段策略 ${slug.replace(/^stage_/, '')}`,
        value: readPromptFile('strategies', file),
      }));
    }
  }

  for (const character of charactersService.listAll()) {
    sources.push(withActive({
      key: `character:${character.id}`,
      kind: 'character',
      label: `角色卡 ${character.name}`,
      value: loadCharacterCard(character.id),
    }));
  }

  return sources;
}

adminPromptsRoute.get('/versions', (c) => {
  const key = c.req.query('key');
  const all = store.state().prompts.versions;
  return c.json(key ? all.filter((v) => v.key === key) : all);
});

adminPromptsRoute.get('/sources', (c) => {
  const key = c.req.query('key');
  const sources = listPromptSources();
  if (!key) return c.json({ sources });
  const found = sources.find((s) => s.key === key);
  if (!found) return c.json({ code: 'NOT_FOUND', message: 'prompt source not found' }, 404);
  return c.json({ source: found });
});

// 系统模板的必需动态槽位 —— 缺失时主 AI 拿不到对应注入（温度块 / 边界条款）。
const REQUIRED_SYSTEM_SLOTS: Array<{ slot: string; label: string }> = [
  { slot: '{{atmosphere_block}}', label: '温度' },
  { slot: '{{boundary_clause}}', label: '边界' },
];

/** 软校验：后台改系统模板若漏掉温度/边界槽位，返回 warning 文案（仅提示，不阻断保存） */
export function systemTemplateSlotWarning(key: string, value: string): string | null {
  if (key !== 'system:template') return null;
  const missing = REQUIRED_SYSTEM_SLOTS.filter((s) => !value.includes(s.slot));
  if (missing.length === 0) return null;
  return `系统模板缺少必需槽位：${missing.map((m) => `${m.label}（${m.slot}）`).join('、')}，` +
    '主 AI 将拿不到对应注入。模板已保存，请尽快补回。';
}

adminPromptsRoute.post(
  '/release',
  zValidator('json', AdminPromptReleaseSchema, validationHook),
  async (c) => {
    const body = c.req.valid('json');
    const s = store.state();
    for (const v of s.prompts.versions) if (v.key === body.key) v.activeAt = null;
    const v = {
      id: `pv_${randomUUID().slice(0, 8)}`,
      key: body.key,
      value: body.value,
      activeAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    s.prompts.versions.push(v);
    store.save();
    audit('prompt.release', body.key, body.reason, { id: v.id });
    const warning = systemTemplateSlotWarning(body.key, body.value);
    return c.json({ ok: true, version: v, ...(warning ? { warning } : {}) });
  },
);

adminPromptsRoute.post(
  '/rollback',
  zValidator('json', AdminPromptRollbackSchema, validationHook),
  async (c) => {
    const body = c.req.valid('json');
    const s = store.state();
    for (const v of s.prompts.versions) {
      if (v.key === body.key) v.activeAt = v.id === body.versionId ? new Date().toISOString() : null;
    }
    store.save();
    audit('prompt.rollback', body.key, body.reason, { versionId: body.versionId });
    return c.json({ ok: true });
  },
);
