import type { Stage } from '@yelan/shared';

export const MEMORY_TRIGGER_KEYWORDS = [
  '关系', '走到哪', '我们算什么', '你怎么看我',
  '现在我们是', '在你眼里', '我对你来说',
] as const;

export interface MemoryGateInput {
  round: number;
  lastMemoryRound: number | null;
  prevStage: Stage;
  curStage: Stage;
  userText: string;
}

export interface MemoryGateDecision {
  inject: boolean;
  reason: 'first-turn' | 'throttle-elapsed' | 'stage-change' | 'keyword' | 'throttled';
}

export function shouldInjectMemory(input: MemoryGateInput): MemoryGateDecision {
  if (input.lastMemoryRound === null) {
    return { inject: true, reason: 'first-turn' };
  }
  if (input.prevStage !== input.curStage) {
    return { inject: true, reason: 'stage-change' };
  }
  if (MEMORY_TRIGGER_KEYWORDS.some(k => input.userText.includes(k))) {
    return { inject: true, reason: 'keyword' };
  }
  if (input.round - input.lastMemoryRound >= 4) {
    return { inject: true, reason: 'throttle-elapsed' };
  }
  return { inject: false, reason: 'throttled' };
}
