// /api/me/* 别名 — web client 习惯调 /api/me/{characters,achievements}
// 把这些请求转回 user 上下文中的对应资源
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  MeNamePatchSchema,
  MeProfilePatchSchema,
  MePasswordSetSchema,
  MePhoneChangeSchema,
  MeAccountDeleteSchema,
  MeEmailBindSchema,
} from '@yelan/shared';
import { mockUserCharacters } from '../fixtures/characters';
import { softAuth, requireAuth } from '../middleware/auth';
import type { Me } from '@yelan/shared';
import type { PersistedUser } from '../store/persistence';
import {
  getUserById,
  patchUserName,
  patchUserProfile,
  setPassword,
  changePhone,
  deleteAccount,
  revokeAllSessions,
  bindEmail,
  PasswordError,
  AccountError,
  EmailAuthError,
} from '../services/users';
import { validationHook } from '../middleware/validation';
import { mockMemoriesRoute } from './me/memories';
import { mockPreferencesRoute } from './me/preferences';
import { mockCreatedCharactersRoute } from './me/created-characters';
import { achievementRepo } from '../store/repositories';

export const mockMeRoute = new Hono();
mockMeRoute.use('*', softAuth());

/**
 * 从持久化 user 行构造对外的 Me 响应。
 * 安全字段只回布尔/时间戳，永不暴露 passwordHash、failedLoginCount、lockedUntil、tokenVersion。
 */
export function toMe(u: PersistedUser): Me {
  return {
    id: u.id,
    name: u.name,
    ...(u.phone ? { phone: u.phone } : {}),
    ageVerified: u.ageVerified,
    narrativeBoundary: u.narrativeBoundary,
    ifUnlocked: u.ifUnlocked,
    createdAt: u.createdAt,
    ...(u.email !== undefined ? { email: u.email } : {}),
    ...(u.nickname !== undefined ? { nickname: u.nickname } : {}),
    ...(u.avatarUrl !== undefined ? { avatarUrl: u.avatarUrl } : {}),
    ...(u.bio !== undefined ? { bio: u.bio } : {}),
    hasPassword: Boolean(u.passwordHash),
    ...(u.passwordUpdatedAt !== undefined ? { passwordUpdatedAt: u.passwordUpdatedAt } : {}),
    ...(u.phoneVerifiedAt !== undefined ? { phoneVerifiedAt: u.phoneVerifiedAt } : {}),
  };
}

mockMeRoute.get('/', (c) => {
  const userId = c.get('userId') as string;
  const u = getUserById(userId);
  if (!u) return c.json({ code: 'NOT_FOUND', message: 'user not found' }, 404);
  return c.json(toMe(u));
});

// PATCH /name 保持 softAuth：这是 NameScene 开门流契约 —— 未登录的访客也能落座 name。
// 改造后 softAuth 给每个浏览器一条独立游客行（X-Device-Id > yl_anon cookie），
// name 落到访客自己的行上，不再写共享匿名号。stale-token 等边角即便命中共享号，
// patchUserName 里的 isSharedAnon 护栏也会挡住写入。见 middleware/auth.ts。
mockMeRoute.patch('/name', zValidator('json', MeNamePatchSchema, validationHook), (c) => {
  const userId = c.get('userId') as string;
  const body = c.req.valid('json');
  const u = patchUserName(userId, body.name);
  if (!u) return c.json({ code: 'NOT_FOUND', message: 'user not found' }, 404);
  return c.json(toMe(u));
});

// PATCH /profile 改放进 requireAuth 子路由 —— 见下方 accountSubRoute。
// 之前在这里走 softAuth 会让过期 token 静默降级到匿名号 → 把 email/nickname
// 写到 ANON_PHONE 共享账号上。这是 codex 抓到的 P1 漏洞。

// POST /api/me/password — 设置/修改密码
// 单独走 requireAuth（不接受匿名号）：匿名号没意义设密码，且 ANON_PHONE 共享
const passwordSubRoute = new Hono();
passwordSubRoute.use('*', requireAuth());
passwordSubRoute.post(
  '/',
  zValidator('json', MePasswordSetSchema, validationHook),
  async (c) => {
    const userId = c.get('userId') as string;
    const body = c.req.valid('json');
    try {
      const { user, token } = await setPassword(userId, body.newPassword, body.currentPassword);
      return c.json({ token, me: toMe(user) });
    } catch (e) {
      if (e instanceof PasswordError) {
        switch (e.code) {
          case 'WEAK':
            return c.json({ code: 'PASSWORD_WEAK', message: e.message }, 400);
          case 'WRONG':
            return c.json({ code: 'PASSWORD_WRONG', message: e.message }, 401);
          case 'NOT_FOUND':
            return c.json({ code: 'NOT_FOUND', message: e.message }, 404);
          default:
            return c.json({ code: 'PASSWORD_ERROR', message: e.message }, 400);
        }
      }
      throw e;
    }
  },
);
mockMeRoute.route('/password', passwordSubRoute);

// /api/me/profile, /api/me/phone, /api/me/sessions, /api/me/delete
// 全部走 requireAuth（匿名号无意义；stale token 必须明确报 401）
const accountSubRoute = new Hono();
accountSubRoute.use('*', requireAuth());

accountSubRoute.patch(
  '/profile',
  zValidator('json', MeProfilePatchSchema, validationHook),
  (c) => {
    const userId = c.get('userId') as string;
    const body = c.req.valid('json');
    try {
      const u = patchUserProfile(userId, body);
      if (!u) return c.json({ code: 'NOT_FOUND', message: 'user not found' }, 404);
      return c.json(toMe(u));
    } catch (e) {
      // emailIndex 冲突 —— 改 email 时另一用户已占用
      if (e instanceof EmailAuthError) {
        return c.json({ code: e.code, message: e.message }, 409);
      }
      throw e;
    }
  },
);

accountSubRoute.post(
  '/email/bind',
  zValidator('json', MeEmailBindSchema, validationHook),
  async (c) => {
    const userId = c.get('userId') as string;
    const body = c.req.valid('json');
    try {
      const { user, token } = await bindEmail(userId, body.email, body.password);
      // 首次绑定（同时设了密码）→ 返回新 token；纯换邮箱不返回 token
      return c.json({ me: toMe(user), ...(token ? { token } : {}) });
    } catch (e) {
      if (e instanceof EmailAuthError) {
        const status = e.code === 'NOT_FOUND' ? 404 : 409;
        return c.json({ code: e.code, message: e.message }, status);
      }
      if (e instanceof PasswordError) {
        const status = e.code === 'WEAK' ? 400
          : e.code === 'NO_PASSWORD' ? 400
          : e.code === 'NOT_FOUND' ? 404
          : 400;
        const code = e.code === 'WEAK' ? 'PASSWORD_WEAK' : e.code;
        return c.json({ code, message: e.message }, status);
      }
      throw e;
    }
  },
);

accountSubRoute.post(
  '/phone/change',
  zValidator('json', MePhoneChangeSchema, validationHook),
  async (c) => {
    const userId = c.get('userId') as string;
    const body = c.req.valid('json');
    try {
      const u = await changePhone(userId, body.newPhone, body.code);
      return c.json(toMe(u));
    } catch (e) {
      if (e instanceof AccountError) {
        const status = e.code === 'NOT_FOUND' ? 404
          : e.code === 'ANON_PROTECTED' ? 403
          : e.code === 'PHONE_TAKEN' ? 409
          : 400;
        return c.json({ code: e.code, message: e.message }, status);
      }
      throw e;
    }
  },
);

accountSubRoute.post('/sessions/revoke-all', (c) => {
  const userId = c.get('userId') as string;
  const { token } = revokeAllSessions(userId);
  return c.json({ ok: true, token });
});

accountSubRoute.post(
  '/delete',
  zValidator('json', MeAccountDeleteSchema, validationHook),
  async (c) => {
    const userId = c.get('userId') as string;
    const body = c.req.valid('json');
    try {
      await deleteAccount(userId, body);
      return c.json({ ok: true });
    } catch (e) {
      if (e instanceof AccountError) {
        const status = e.code === 'NOT_FOUND' ? 404
          : e.code === 'ANON_PROTECTED' ? 403
          : e.code === 'WRONG_PASSWORD' ? 401
          : 400;
        return c.json({ code: e.code, message: e.message }, status);
      }
      throw e;
    }
  },
);

// 挂载到 me — 注意路径：/api/me/phone/change, /api/me/sessions/revoke-all, /api/me/delete
mockMeRoute.route('/', accountSubRoute);

mockMeRoute.get('/characters', (c) => c.json(mockUserCharacters));
mockMeRoute.get('/achievements', async (c) => {
  const userId = c.get('userId') as string;
  const rows = await achievementRepo.listByUser(userId);
  return c.json(rows);
});

mockMeRoute.route('/memories', mockMemoriesRoute);
mockMeRoute.route('/preferences', mockPreferencesRoute);
mockMeRoute.route('/created-characters', mockCreatedCharactersRoute);
