import { load } from 'js-yaml';

/** 解析角色卡 / 策略 / 边界 YAML，内部使用 js-yaml 保证与 prompts build 一致 */
export function parseTinyYaml(text: string): Record<string, unknown> {
  const result = load(text);
  if (result === null || result === undefined) return {};
  if (typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('YAML 顶层必须是 object，不能是 ' + typeof result + (Array.isArray(result) ? ' array' : ''));
  }
  return result as Record<string, unknown>;
}
