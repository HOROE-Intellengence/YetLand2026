// 氛围判断 AI — 每次用户发消息时触发；时序由「策略」面板 TEMPERATURE_OPTIMISTIC 决定：
// 乐观=异步触发、温度记入日志供下一轮；同步=主 AI 回复前阻塞判定本轮。判断对话温度 1-5。
import type { AtmosphereInput, AtmosphereResult, SidecarResult } from './types';
import { getPrompt } from './prompts';
import { sidecarCallWithSchema } from './client';
import { AtmosphereResultSchema } from '@yelan/shared';
import { store } from '../store/persistence';
import { FEATURE_FLAGS, flag } from '../config/feature-flags';

function getRecentTemperatures(sessionId: string): number[] {
  const s = store.state();
  const row = (s as any).temperatureLogs?.[sessionId] as { values?: number[] } | undefined;
  return row?.values ?? [];
}

export function recordTemperature(sessionId: string, temp: number): void {
  const s = store.state();
  if (!(s as any).temperatureLogs) (s as any).temperatureLogs = {};
  const row = ((s as any).temperatureLogs[sessionId] ??= { values: [], updatedAt: new Date().toISOString() }) as {
    values: number[];
    updatedAt: string;
  };
  row.values.push(temp);
  // 只保留最近 100 条
  if (row.values.length > 100) row.values = row.values.slice(-100);
  row.updatedAt = new Date().toISOString();
  store.save();
}

function buildUserContent(input: AtmosphereInput): string {
  const lines = [
    `角色名称：${input.characterName}`,
    `角色性格：${input.characterPersonality}`,
    `当前内容边界：B${input.boundary}`,
    `升温规则：${input.warmingRule || '标准'}`,
    input.maxTemperature ? `温度上限：${input.maxTemperature}` : '',
    `最近 5 次温度：${input.recentTemperatures.join(', ') || '无记录'}`,
    input.codeMatched ? '本轮命中 IF 暗号：是。它是当前上下文信号，不是温度下限。' : '',
    `最近对话：${input.recentConversation.slice(0, 1000)}`,
    `用户本轮输入：${input.userInput.slice(0, 500)}`,
  ];

  if (flag(FEATURE_FLAGS.TEMP_V2)) {
    lines.push(
      `当前阶段：${input.stage}`,
      `当前轮数：第 ${input.round} 轮`,
      `IF 状态：${input.ifActive ? '已激活' : '未激活'}`,
    );
  }

  return lines.filter(Boolean).join('\n');
}

function clampTemperature(result: AtmosphereResult, input: AtmosphereInput): AtmosphereResult {
  const min = 1;
  const max = input.maxTemperature ?? 5;
  const temperature = Math.min(max, Math.max(min, result.temperature));
  return temperature === result.temperature ? result : { temperature };
}

export async function judgeAtmosphere(
  input: AtmosphereInput,
  sessionId: string,
): Promise<SidecarResult<AtmosphereResult>> {
  const prompt = getPrompt('atmosphereJudge');
  const userContent = buildUserContent(input);

  const result = await sidecarCallWithSchema(prompt, userContent, AtmosphereResultSchema, { timeoutMs: 5000 });
  if (result.ok && result.data) {
    result.data = clampTemperature(result.data, input);
    recordTemperature(sessionId, result.data.temperature);
  }
  return result;
}

/** 获取 session 最近温度记录（注入主 AI 用） */
export function getTemperatureLog(sessionId: string): number[] {
  return getRecentTemperatures(sessionId);
}

/** 获取当前温度（降级策略：沿用上一次温度，默认 3） */
export function getCurrentTemperature(sessionId: string): number {
  const temps = getRecentTemperatures(sessionId);
  return temps.length > 0 ? temps[temps.length - 1]! : 3;
}
