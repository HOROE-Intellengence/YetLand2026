import type { Stage, RecallPayload } from '@yelan/shared';
import { renderSystemPromptSimple } from '@yelan/shared';
import { loadCharacterCard, loadStrategyForStage } from './loader';
import type { Env } from '../types/bindings';

export async function assembleSystemPrompt(env: Env, args: {
  characterId: string;
  stage: Stage;
  boundary: 1 | 2 | 3 | 4 | 5;
  recall?: RecallPayload;
  cutoffWarning?: boolean;
}): Promise<string> {
  const card = await loadCharacterCard(env, args.characterId);
  const strategy = await loadStrategyForStage(env, args.stage);

  return renderSystemPromptSimple({
    preludeCard: '',
    characterCard: card,
    boundaryClause: '',
    stageStrategy: strategy,
    recall: args.recall,
    cutoffWarning: args.cutoffWarning ?? false,
  });
}
