import { randomUUID } from 'node:crypto';
import { store, type LlmApiEntry } from '../store/persistence';
import type { SidecarPromptKey } from '@yelan/shared';
import type { ReasoningEffort } from '@yelan/llm';
import { isPhoneTextModelScope } from './llm-scope';

export const REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high'] as const;
export type ReasoningScenario = 'normal' | 'cipher';
const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'low';

export type LlmRole = 'main' | 'sidecar' | 'phone';
export const SIDECAR_TASK_API_KEYS = ['outputStructurer', 'preferenceRecorder', 'quotaEnding', 'contextCompressor'] as const;
export type SidecarTaskApiKey = typeof SIDECAR_TASK_API_KEYS[number];

export interface LlmApiInput {
  id?: string;
  name: string;
  protocol: LlmApiEntry['protocol'];
  baseUrl?: string;
  model: string;
  apiKey: string;
  enabled?: boolean;
}

export interface LlmApiConfig {
  id: string;
  name: string;
  protocol: LlmApiEntry['protocol'];
  baseUrl: string;
  model: string;
  apiKey: string;
}

export function isSidecarTaskApiKey(value: string): value is SidecarTaskApiKey {
  return (SIDECAR_TASK_API_KEYS as readonly string[]).includes(value);
}

function now(): string {
  return new Date().toISOString();
}

function sanitizeId(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function mask(value: string): string {
  if (!value) return '';
  if (value.length <= 10) return '****';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function defaultBaseUrl(protocol: LlmApiEntry['protocol'], baseUrl?: string): string {
  if (baseUrl?.trim()) return baseUrl.trim().replace(/\/+$/, '');
  if (protocol === 'anthropic') return 'https://api.anthropic.com';
  if (protocol === 'nvidia') return 'https://integrate.api.nvidia.com/v1';
  return 'https://api.openai.com/v1';
}

function envSeedEntries(): LlmApiEntry[] {
  const at = now();
  const entries: LlmApiEntry[] = [];
  const push = (entry: Omit<LlmApiEntry, 'createdAt' | 'updatedAt'>) => {
    if (!entry.apiKey || entry.apiKey.length <= 10) return;
    entries.push({ ...entry, createdAt: at, updatedAt: at });
  };

  // 只播种「指定角色」：一个 main + 侧袋默认 + 侧袋任务。
  // 不再为每个 provider key 各播一条可被回退选中的条目（尤其 .env 里标注为「备用」的
  // NVIDIA glm-5.1）——那类备用/扩展模型只会在库里当兜底候选，拖垮延时、把分句打成兜底。
  // 需要更多模型时用 admin「扩展 API」手动添加（CRUD 接口保留）。

  // 主模型：按 Anthropic > OpenAI > DeepSeek > NVIDIA 取第一个有 key 的，只播一条 env-main。
  // NVIDIA 只在前三家都没配置时作为主模型播种，不再作为额外 fallback 混进链路。
  const mainCandidates: Array<Omit<LlmApiEntry, 'id' | 'name' | 'enabled' | 'createdAt' | 'updatedAt'>> = [
    { protocol: 'anthropic', baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com', model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6', apiKey: process.env.ANTHROPIC_API_KEY || '' },
    { protocol: 'openai-compatible', baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1', model: process.env.OPENAI_MODEL || 'gpt-4o-mini', apiKey: process.env.OPENAI_API_KEY || '' },
    { protocol: 'openai-compatible', baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1', model: process.env.DEEPSEEK_MODEL || 'deepseek-chat', apiKey: process.env.DEEPSEEK_API_KEY || '' },
    { protocol: 'nvidia', baseUrl: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1', model: process.env.NVIDIA_MODEL || process.env.NVIDIA_DEFAULT_MODEL || 'z-ai/glm-5.1', apiKey: process.env.NVIDIA_API_KEY || '' },
  ];
  const mainPick = mainCandidates.find((c) => c.apiKey && c.apiKey.length > 10);
  if (mainPick) push({ id: 'env-main', name: 'Env Main', enabled: true, ...mainPick });

  push({
    id: 'env-sidecar',
    name: 'Env Sidecar',
    protocol: 'openai-compatible',
    baseUrl: process.env.SIDECAR_BASE_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
    model: process.env.SIDECAR_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    apiKey: process.env.SIDECAR_API_KEY || process.env.DEEPSEEK_API_KEY || '',
    enabled: true,
  });
  push({
    id: 'env-sidecar-tasks',
    name: 'Env Sidecar Tasks',
    protocol: 'openai-compatible',
    baseUrl: process.env.SIDECAR_TASK_BASE_URL || process.env.SIDECAR_BASE_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
    model: process.env.SIDECAR_TASK_MODEL || process.env.SIDECAR_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    apiKey: process.env.SIDECAR_TASK_API_KEY || process.env.SIDECAR_AUX_API_KEY || '',
    enabled: true,
  });
  return entries;
}

export function ensureLlmApiInventorySeeded(): void {
  const inv = store.state().llmApiInventory;
  inv.sidecarTaskApiIds ??= {};
  if (Object.keys(inv.entries).length > 0) return;
  const seeded = envSeedEntries();
  for (const entry of seeded) inv.entries[entry.id] = entry;
  inv.mainApiId = seeded.find((entry) => entry.id !== 'env-sidecar' && entry.id !== 'env-sidecar-tasks')?.id ?? null;
  inv.sidecarApiId = seeded.find((entry) => entry.id === 'env-sidecar')?.id ?? inv.mainApiId;
  const taskEntry = seeded.find((entry) => entry.id === 'env-sidecar-tasks');
  if (taskEntry) {
    for (const taskKey of SIDECAR_TASK_API_KEYS) inv.sidecarTaskApiIds[taskKey] = taskEntry.id;
  }
  if (seeded.length > 0) store.save();
}

export function listLlmApis() {
  ensureLlmApiInventorySeeded();
  const inv = store.state().llmApiInventory;
  return {
    entries: Object.values(inv.entries).map((entry) => ({
      ...entry,
      apiKey: '',
      maskedKey: mask(entry.apiKey),
      ready: entry.enabled && entry.apiKey.length > 10,
    })),
    mainApiId: inv.mainApiId,
    sidecarApiId: inv.sidecarApiId,
    phoneApiId: inv.phoneApiId === undefined ? inv.mainApiId : inv.phoneApiId,
    sidecarTaskApiIds: inv.sidecarTaskApiIds ?? {},
    mainReasoningEffort: inv.mainReasoningEffort ?? DEFAULT_REASONING_EFFORT,
    mainReasoningEffortCipher: inv.mainReasoningEffortCipher ?? DEFAULT_REASONING_EFFORT,
  };
}

/** 取主 AI 推理档位：普通场景 vs 暗号(IF 解锁)场景。 */
export function getMainReasoningEffort(scenario: ReasoningScenario): ReasoningEffort {
  ensureLlmApiInventorySeeded();
  const inv = store.state().llmApiInventory;
  const value = scenario === 'cipher' ? inv.mainReasoningEffortCipher : inv.mainReasoningEffort;
  return value ?? DEFAULT_REASONING_EFFORT;
}

/** 设主 AI 推理档位。 */
export function setMainReasoningEffort(scenario: ReasoningScenario, value: ReasoningEffort): void {
  ensureLlmApiInventorySeeded();
  const inv = store.state().llmApiInventory;
  if (scenario === 'cipher') inv.mainReasoningEffortCipher = value;
  else inv.mainReasoningEffort = value;
  store.save();
}

export function upsertLlmApi(input: LlmApiInput): LlmApiEntry {
  ensureLlmApiInventorySeeded();
  const inv = store.state().llmApiInventory;
  // 显式 id 先清洗；清洗后为空（如纯中文「偏好及上下文」会被 sanitizeId 收成 ''）视为「未提供」，
  // 回退到 name/uuid 自动生成。否则会写出 entries[''] = { id: '' } 的脏条目
  // （2026-06-07 实测复现：用户在「扩展 API」id 框填中文，schema 只校验 min(1) 放行，
  //  sanitizeId 收成空串，而旧分支对显式 id 没有空串兜底）。
  const explicit = input.id ? sanitizeId(input.id) : '';
  let id = explicit || `api-${sanitizeId(input.name) || randomUUID().slice(0, 8)}`;
  // 自动生成 id（无显式 id，或显式 id 清洗后为空）时，若已被占用则追加后缀以避免覆盖。
  // 显式且合法的 id 命中现有条目则按「编辑」语义 upsert，不在此追加后缀。
  if (!explicit && inv.entries[id]) {
    let i = 2;
    while (inv.entries[`${id}-${i}`]) i++;
    id = `${id}-${i}`;
  }
  const prev = inv.entries[id];
  const at = now();
  const entry: LlmApiEntry = {
    id,
    name: input.name.trim(),
    protocol: input.protocol,
    baseUrl: defaultBaseUrl(input.protocol, input.baseUrl),
    model: input.model.trim(),
    apiKey: input.apiKey.trim() || prev?.apiKey || '',
    enabled: input.enabled ?? prev?.enabled ?? true,
    createdAt: prev?.createdAt ?? at,
    updatedAt: at,
  };
  inv.entries[id] = entry;
  if (!inv.mainApiId) inv.mainApiId = id;
  if (!inv.sidecarApiId) inv.sidecarApiId = id;
  store.save();
  return entry;
}

export function deleteLlmApi(id: string): boolean {
  ensureLlmApiInventorySeeded();
  const inv = store.state().llmApiInventory;
  if (!inv.entries[id]) return false;
  delete inv.entries[id];
  const first = Object.values(inv.entries)[0]?.id ?? null;
  if (inv.mainApiId === id) inv.mainApiId = first;
  if (inv.sidecarApiId === id) inv.sidecarApiId = first;
  if (inv.phoneApiId === id) inv.phoneApiId = null;
  for (const [taskKey, taskApiId] of Object.entries(inv.sidecarTaskApiIds ?? {})) {
    if (taskApiId === id) {
      inv.sidecarTaskApiIds[taskKey as SidecarPromptKey] = null;
    }
  }
  store.save();
  return true;
}

export function selectLlmApi(role: LlmRole, id: string | null): void {
  ensureLlmApiInventorySeeded();
  const inv = store.state().llmApiInventory;
  if (id && !inv.entries[id]) throw new Error('api entry not found');
  if (role === 'phone' && id && inv.entries[id]?.protocol !== 'openai-compatible') throw new Error('小手机文本渠道需使用 OpenAI-compatible 协议');
  if (role === 'main') inv.mainApiId = id;
  else if (role === 'phone') inv.phoneApiId = id;
  else inv.sidecarApiId = id;
  store.save();
}

export function selectSidecarTaskApi(taskKey: SidecarTaskApiKey, id: string | null): void {
  ensureLlmApiInventorySeeded();
  const inv = store.state().llmApiInventory;
  if (id && !inv.entries[id]) throw new Error('api entry not found');
  inv.sidecarTaskApiIds ??= {};
  inv.sidecarTaskApiIds[taskKey] = id;
  store.save();
}

function isReady(entry: LlmApiEntry | undefined | null): entry is LlmApiEntry {
  return Boolean(entry?.enabled && entry.apiKey.length > 10);
}

function toConfig(entry: LlmApiEntry): LlmApiConfig {
  return {
    id: entry.id,
    name: entry.name,
    protocol: entry.protocol,
    baseUrl: entry.baseUrl,
    model: entry.model,
    apiKey: entry.apiKey,
  };
}

function taskBoundIds(inv: { sidecarTaskApiIds?: Partial<Record<SidecarPromptKey, string | null>> }): Set<string> {
  return new Set(Object.values(inv.sidecarTaskApiIds ?? {}).filter((id): id is string => Boolean(id)));
}

export function getLlmApiConfig(role: LlmRole, taskKey?: SidecarPromptKey): LlmApiConfig | null {
  ensureLlmApiInventorySeeded();
  const inv = store.state().llmApiInventory;
  if (role === 'phone' || isPhoneTextModelScope()) {
    // Missing field preserves legacy installs; an explicit unbinding or an
    // unavailable selected phone entry fails closed, without model switching.
    const id = inv.phoneApiId === undefined ? inv.mainApiId : inv.phoneApiId;
    const entry = id ? inv.entries[id] : null;
    return isReady(entry) && entry.protocol === 'openai-compatible' ? toConfig(entry) : null;
  }
  // 侧袋任务可单独绑定模型：绑定且就绪 → 用它；否则落到管理员指定的 sidecar 默认。
  if (role === 'sidecar' && taskKey) {
    const taskEntryId = inv.sidecarTaskApiIds?.[taskKey];
    if (taskEntryId) {
      const taskEntry = inv.entries[taskEntryId];
      if (isReady(taskEntry)) return toConfig(taskEntry);
      console.warn(`[llm-api] sidecar task ${taskKey} entry ${taskEntryId} unavailable; using designated sidecar default`);
    }
  }
  // 强约束：只用后台显式指定的条目（main=mainApiId / sidecar=sidecarApiId）。
  // 指定条目不就绪时返回 null（→ 调用方显式降级），绝不静默改用库里其它就绪条目——
  // 这正是此前侧袋会偷偷落到 env-nvidia(glm-5.1) 拖垮延时、把分句打成兜底的根因。
  // 其它条目仅作"扩展库/手动选择"用途，不再参与自动回退。
  const selectedId = role === 'main' ? inv.mainApiId : inv.sidecarApiId;
  const selected = selectedId ? inv.entries[selectedId] : null;
  return isReady(selected) ? toConfig(selected) : null;
}

/** 仅返回主路由可用的 provider（仅选中的 main，不含 sidecar/env 回退） */
export function getMainRouterConfigs(): LlmApiConfig[] {
  if (isPhoneTextModelScope()) {
    const phone = getLlmApiConfig('phone');
    return phone ? [phone] : [];
  }
  ensureLlmApiInventorySeeded();
  const inv = store.state().llmApiInventory;
  const mainEntry = inv.mainApiId ? inv.entries[inv.mainApiId] : null;
  if (isReady(mainEntry)) return [toConfig(mainEntry)];
  return [];
}

export function getEnabledLlmApiConfigs(): LlmApiConfig[] {
  ensureLlmApiInventorySeeded();
  const inv = store.state().llmApiInventory;
  const reserved = taskBoundIds(inv);
  const selectedIds = new Set([inv.mainApiId, inv.sidecarApiId].filter((id): id is string => Boolean(id)));
  return Object.values(inv.entries)
    .filter((entry) => isReady(entry) && (!reserved.has(entry.id) || selectedIds.has(entry.id)))
    .map(toConfig);
}
