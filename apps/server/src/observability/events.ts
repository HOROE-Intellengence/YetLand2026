// 埋点写入。最小集见开发文档 §三.6
import type { Env } from '../types/bindings';
import type { TelemetryEvent } from '@yelan/shared';

export async function recordEvents(_env: Env, _events: TelemetryEvent[]): Promise<void> {
  // TODO: 批量写 events 表 / ClickHouse
}
