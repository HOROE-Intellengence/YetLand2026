// stage 判定（关键词 + 轮次 + 时间窗口）。api / server 共用的纯逻辑。
import type { Stage } from '../enums/stage';

const CLIMAX_KW = ['吻', '抱', '抱紧', '抱住', '心跳', '颤', '别离开', '别走', '答应我'];
const RISE_KW = ['告诉我', '为什么', '想知道', '其实', '说真的', '真的吗'];
const AFTER_KW = ['后来', '安静', '靠在', '靠着', '听着'];

export interface StageInput {
  round: number;
  text: string;
  hourLocal: number;
  prevStage: Stage;
}

export function judgeStage(input: StageInput): Stage {
  const { round, text, hourLocal, prevStage } = input;

  // 单调推进，不回退到比 prev 更前的阶段
  if (prevStage === 'after') return 'after';
  if (prevStage === 'end') return 'end';

  if (CLIMAX_KW.some((k) => text.includes(k))) return 'climax';
  if (prevStage === 'climax' && AFTER_KW.some((k) => text.includes(k))) return 'after';

  if (round >= 12) return prevStage === 'rise' || prevStage === 'climax' ? prevStage : 'rise';
  if (round >= 6) {
    if (RISE_KW.some((k) => text.includes(k))) return 'rise';
    return prevStage === 'daily' ? 'rise' : prevStage;
  }

  // 深夜稍微推进氛围
  if ((hourLocal >= 0 && hourLocal < 5) && round >= 3) return 'rise';

  return 'daily';
}
