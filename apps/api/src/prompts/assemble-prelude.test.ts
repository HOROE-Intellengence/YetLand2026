import { beforeEach, describe, expect, it } from 'vitest';
import { store } from '../store/persistence';
import { preludeCardsService } from '../services/prelude-cards';
import { assembleSystemPrompt } from './assemble';

describe('assembleSystemPrompt prelude cards', () => {
  beforeEach(() => {
    store.__resetForTests();
  });

  it('injects IF prelude only when IF is active and carries the boundary clause', () => {
    preludeCardsService.upsert({
      id: 'itest-if-prelude',
      name: 'IF Test Prelude',
      content: 'ITEST_PRELUDE_MARKER',
      scope: 'if',
      priority: 999,
      isActive: true,
    });

    const ifPrompt = assembleSystemPrompt({
      characterId: 'shen-yan-zhi',
      stage: 'daily',
      boundary: 2,
      ifActive: true,
    });
    const normalPrompt = assembleSystemPrompt({
      characterId: 'shen-yan-zhi',
      stage: 'daily',
      boundary: 2,
      ifActive: false,
    });

    expect(ifPrompt).toContain('ITEST_PRELUDE_MARKER');
    expect(normalPrompt).not.toContain('ITEST_PRELUDE_MARKER');
    // 边界条款现在按生效档位注入主 prompt（此前被传空串漏掉）。
    expect(ifPrompt).toContain('Boundary 2');
  });

  // 守护：主 AI「非必要结尾不提问」是全局约束，曾经在某次合并中丢失。
  // 任何分支/角色/阶段装配出的 system prompt 都必须保留它。
  it('always carries the global no-trailing-question constraint', () => {
    const prompt = assembleSystemPrompt({
      characterId: 'shen-yan-zhi',
      stage: 'daily',
      boundary: 3,
      ifActive: false,
    });
    expect(prompt).toContain('非必要不在回答结尾提问');
  });
});
