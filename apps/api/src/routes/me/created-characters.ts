// /api/me/created-characters —— 用户自定义角色卡（feat/user-character-cards）
// POST  创建（需登录）：结构化 payload → 编译进既有 profileSections → 落库（私有/待审）
// GET   列出本人创建的卡（含私有/待审/已拒）
// 说明：与既有 /api/me/characters（已解锁角色清单）刻意分路径，互不干扰。
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { UserCharacterCreateSchema } from '@yelan/shared';
import { requireAuth } from '../../middleware/auth';
import { validationHook } from '../../middleware/validation';
import { charactersService } from '../../services/characters';
import { getUserById } from '../../services/users';

export const mockCreatedCharactersRoute = new Hono();
// 创建角色卡需登录 —— 游客（无有效 token）一律 401，绝不落到匿名号。
mockCreatedCharactersRoute.use('*', requireAuth());

mockCreatedCharactersRoute.get('/', (c) => {
  const userId = c.get('userId') as string;
  return c.json({ characters: charactersService.listCreatedBy(userId) });
});

mockCreatedCharactersRoute.post(
  '/',
  zValidator('json', UserCharacterCreateSchema, validationHook),
  (c) => {
    const userId = c.get('userId') as string;
    const payload = c.req.valid('json');
    const created = charactersService.createFromUser(userId, payload);
    const user = getUserById(userId);
    // 后台档案视图：角色名 / 用户名 / id + 结构化原文（非拼装 prompt 原文，防注入）。
    return c.json(
      {
        character: created,
        profile: {
          id: created.id,
          characterName: created.name,
          userName: user?.nickname ?? user?.name ?? user?.email ?? userId,
          ownerUserId: userId,
        },
      },
      201,
    );
  },
);
