// BE-104 — 用量规则中央化
// 所有业务常量不再从 @yelan/shared 硬编码读取，改走 policy 表
// 启动时 seed 初始值；运营在 #policy 面板实时改，下一轮对话立即生效
import { store, type PolicyKvRow } from '../store/persistence';
import {
  POLICY_DEFINITIONS,
  POLICY_GROUPS,
  PolicyValidationError,
  coercePolicyValue,
  getPolicyDefinition,
  type PolicyGroup,
  type PolicyValue,
} from './policy-definitions';

function now(): string {
  return new Date().toISOString();
}

let _cached: Record<string, PolicyKvRow> | null = null;

export interface PolicyView extends PolicyKvRow {
  label: string;
  group: PolicyGroup;
  type: 'number' | 'boolean' | 'string';
  default: PolicyValue;
  min?: number;
  max?: number;
  description: string;
}

function load(): Record<string, PolicyKvRow> {
  if (_cached) return _cached;
  const s = store.state();
  // 首次启动 seed，并补齐任何缺失的定义键 —— 新增 policy 定义在已有 state.json 上
  // 也能立即出现在「策略」面板（旧逻辑只在 policies 为空时 seed，新键不会回填）。
  let seededAny = false;
  for (const def of Object.values(POLICY_DEFINITIONS)) {
    if (!s.policies[def.key]) {
      s.policies[def.key] = { key: def.key, value: def.default, updatedBy: 'system', updatedAt: now() };
      seededAny = true;
    }
  }
  if (seededAny) store.save();
  _cached = { ...s.policies };
  return _cached;
}

export function clearPolicyCache(): void {
  _cached = null;
}

export const policyService = {
  /** 读一个策略值；支持类型泛型 + fallback */
  get<T extends string | number | boolean>(key: string, fallback: T): T {
    const all = load();
    const row = all[key];
    if (!row) return fallback;
    try {
      return coercePolicyValue(key, row.value) as T;
    } catch {
      return fallback;
    }
  },

  /** 写（运营面板用），返回新值 */
  set(key: string, value: string | number | boolean, updatedBy: string): PolicyKvRow {
    const parsed = coercePolicyValue(key, value);
    const s = store.state();
    const row: PolicyKvRow = { key, value: parsed, updatedBy, updatedAt: now() };
    s.policies[key] = row;
    store.save();
    _cached = { ...s.policies };
    return row;
  },

  /** 列出全部策略（运营面板用） */
  listAll(): PolicyView[] {
    return Object.values(load())
      .map((row) => {
        const def = getPolicyDefinition(row.key);
        if (!def) return null;
        return { ...row, ...def, value: this.get(row.key, def.default) };
      })
      .filter((row): row is PolicyView => Boolean(row));
  },

  /** 按分组列出（配额 / 成本 / 内容策略 / 杂项） */
  listByGroup(): Record<PolicyGroup, PolicyView[]> {
    const groups = Object.fromEntries(POLICY_GROUPS.map((g) => [g, []])) as unknown as Record<PolicyGroup, PolicyView[]>;
    const all = this.listAll();
    for (const row of all) {
      groups[row.group].push(row);
    }
    return groups;
  },
  isPolicyValidationError(e: unknown): e is PolicyValidationError {
    return e instanceof PolicyValidationError;
  },
};
