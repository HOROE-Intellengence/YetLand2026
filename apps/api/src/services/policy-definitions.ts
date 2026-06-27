export type PolicyValue = string | number | boolean;
export type PolicyValueType = 'number' | 'boolean' | 'string';
export type PolicyGroup = '配额' | '成本' | '内容策略' | '杂项';

export interface PolicyDefinition {
  key: string;
  label: string;
  group: PolicyGroup;
  type: PolicyValueType;
  default: PolicyValue;
  min?: number;
  max?: number;
  description: string;
}

export const POLICY_DEFINITIONS = {
  DAILY_FREE_ROUND_LIMIT: {
    key: 'DAILY_FREE_ROUND_LIMIT',
    label: '免费每日轮次',
    group: '配额',
    type: 'number',
    default: 20,
    min: 1,
    max: 200,
    description: '完全免费用户每日可对话轮次上限。',
  },
  REGISTER_CANDLE_GRANT: {
    key: 'REGISTER_CANDLE_GRANT',
    label: '注册赠烛',
    group: '配额',
    type: 'number',
    default: 100,
    min: 0,
    max: 100000,
    description: '新用户注册时一次性发放的烛数量。',
  },
  SURVEY_MIN_DWELL_SECONDS: {
    key: 'SURVEY_MIN_DWELL_SECONDS',
    label: '问卷最短停留秒数',
    group: '配额',
    type: 'number',
    default: 5,
    min: 0,
    max: 600,
    description: '单题提交前必须停留的最短秒数。',
  },
  CONTEXT_COMPRESS_TOKEN_LIMIT: {
    key: 'CONTEXT_COMPRESS_TOKEN_LIMIT',
    label: '上下文压缩阈值',
    group: '内容策略',
    type: 'number',
    default: 8000,
    min: 1000,
    max: 200000,
    description: '对话历史超过该 token 数时触发上下文压缩。',
  },
  KEY_SENTENCE_PAUSE_MS: {
    key: 'KEY_SENTENCE_PAUSE_MS',
    label: '关键句停顿毫秒',
    group: '内容策略',
    type: 'number',
    default: 700,
    min: 0,
    max: 3000,
    description: 'glow 关键句额外停顿时长。',
  },
  IF_DAILY_REDEEM_LIMIT: {
    key: 'IF_DAILY_REDEEM_LIMIT',
    label: 'IF 暗号每日兑换上限',
    group: '配额',
    type: 'number',
    default: 3,
    min: 0,
    max: 100,
    description: '单用户每天最多可兑换 IF 暗号次数。',
  },
  EXCHANGE_ENABLED: {
    key: 'EXCHANGE_ENABLED',
    label: '烛兑换开关',
    group: '配额',
    type: 'boolean',
    default: true,
    description: '是否允许 candle 兑换额度（解锁角色）。',
  },
  TEMPERATURE_OPTIMISTIC: {
    key: 'TEMPERATURE_OPTIMISTIC',
    label: '温度·乐观异步模式',
    group: '内容策略',
    type: 'boolean',
    default: true,
    description:
      'true=乐观异步：本轮立即用上一轮温度开流、不阻塞首字，氛围判断异步刷新供下一轮（温度对本轮输入晚一轮反应）。' +
      'false=同步阻塞：主 AI 回复前先等氛围判断，温度实时反应当轮输入，但每轮首字多等一次侧袋 LLM。',
  },
} as const satisfies Record<string, PolicyDefinition>;

export const POLICY_GROUPS: PolicyGroup[] = ['配额', '成本', '内容策略', '杂项'];

export class PolicyValidationError extends Error {
  constructor(
    message: string,
    readonly code: 'UNKNOWN_POLICY_KEY' | 'INVALID_POLICY_VALUE',
  ) {
    super(message);
  }
}

export function getPolicyDefinition(key: string): PolicyDefinition | undefined {
  return POLICY_DEFINITIONS[key as keyof typeof POLICY_DEFINITIONS];
}

export function coercePolicyValue(key: string, value: unknown): PolicyValue {
  const def = getPolicyDefinition(key);
  if (!def) throw new PolicyValidationError(`Unknown policy key: ${key}`, 'UNKNOWN_POLICY_KEY');

  if (def.type === 'number') {
    const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
    if (!Number.isFinite(n)) throw new PolicyValidationError(`${key} must be a number`, 'INVALID_POLICY_VALUE');
    if (def.min !== undefined && n < def.min) throw new PolicyValidationError(`${key} must be >= ${def.min}`, 'INVALID_POLICY_VALUE');
    if (def.max !== undefined && n > def.max) throw new PolicyValidationError(`${key} must be <= ${def.max}`, 'INVALID_POLICY_VALUE');
    return n;
  }

  if (def.type === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new PolicyValidationError(`${key} must be a boolean`, 'INVALID_POLICY_VALUE');
  }

  if (typeof value !== 'string') throw new PolicyValidationError(`${key} must be a string`, 'INVALID_POLICY_VALUE');
  return value.trim();
}
