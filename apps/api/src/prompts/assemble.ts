import type { Stage, RecallPayload } from '@yelan/shared';
import { renderSystemPrompt } from '@yelan/shared';
import {
  loadCharacterCard,
  loadStrategyForStage,
  loadPreludeCard,
  loadBoundaryClause,
  getSystemTemplate,
} from './loader';

interface AssembleArgs {
  characterId: string;
  stage: Stage;
  boundary: 1 | 2 | 3 | 4 | 5;
  ifActive?: boolean;
  recall?: RecallPayload;
  cutoffWarning?: boolean;
  /** 每轮动态温度块（含温度行为指引 + 画像 + 概要），有 {{atmosphere_block}} 槽位则就地填入，否则追加到尾部 */
  atmosphereBlock?: string;
}

export function assembleSystemPrompt(args: AssembleArgs): string {
  const prelude = loadPreludeCard(args.characterId, Boolean(args.ifActive));
  const card = loadCharacterCard(args.characterId);
  const strategy = loadStrategyForStage(args.stage);
  // 边界条款按生效边界档位注入主 prompt —— 边界档来自 chat.ts 的 effectiveBoundary(userBoundary, globalBoundary)。
  const boundaryClause = loadBoundaryClause(args.boundary);
  const template = getSystemTemplate();

  return renderSystemPrompt({
    preludeCard: prelude,
    characterCard: card,
    boundaryClause,
    stageStrategy: strategy,
    atmosphereBlock: args.atmosphereBlock,
    recall: args.recall,
    cutoffWarning: args.cutoffWarning,
    template,
  });
}
