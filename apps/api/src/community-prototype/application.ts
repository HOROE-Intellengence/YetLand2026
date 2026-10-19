import { Hono, type Context } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  registerWithEmail,
  loginWithEmail,
  getUserById,
  getUserByToken,
  parseTokenVersion,
  deleteAccount,
} from '../services/users';
import { charactersService } from '../services/characters';
import { store } from '../store/persistence';
import { resources as seeds, type PrototypeResource } from './catalog';
import { Repository, SubmissionSchema, type Account, type Role, type Resource } from './repository';
import type { UserCharacterCreate } from '@yelan/shared';
import { PhoneRoleRulesSchema, INSPECTION_ASSET_LIMIT, INSPECTION_IMAGE_INPUT_LIMIT } from '@yelan/shared';
import { AccountAssets } from './assets';
import { communityPhonePersona } from './phone-persona';
import { characterPreview } from './preview';

const root = resolve(import.meta.dirname, '../../../..');
const integrated = process.env.COMMUNITY_ACCOUNT_MODE === 'shared';
const state = resolve(process.env.COMMUNITY_STATE_DIR || resolve(root, '.local/community-prototype'));
if (!integrated && resolve(process.env.YELAN_STATE_DIR ?? '') !== resolve(state, 'accounts'))
  throw new Error('Prototype must use its isolated account directory');
mkdirSync(state, { recursive: true });
const config = JSON.parse(readFileSync(resolve(state, 'runtime.json'), 'utf8')) as {
  bridgeSecret: string;
  demoPassword: string;
};
const origin = process.env.COMMUNITY_PUBLIC_ORIGIN || 'http://localhost:3038';
const forumOrigin = process.env.COMMUNITY_FORUM_ORIGIN || 'http://localhost:4567';
const phoneOrigin = process.env.COMMUNITY_PHONE_ORIGIN || 'http://localhost:3041';
const forumInternal = process.env.COMMUNITY_NODEBB_URL || forumOrigin;
const repo = new Repository(resolve(state, 'installations.sqlite'));
const db = repo.db;
const assets = new AccountAssets(db);
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const now = () => new Date().toISOString();
function fail(status: 400 | 401 | 403 | 404 | 409 | 429 | 503, message: string): never {
  throw new HTTPException(status, { message });
}
function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  return r.success ? r.data : fail(400, r.error.issues.map((i) => i.message).join('；'));
}
const demos: { key: string; email: string; name: string; role: Role }[] = [
  { key: 'a', email: 'reader-a@community.example.test', name: '林间来信', role: 'member' },
  { key: 'b', email: 'reader-b@community.example.test', name: '海边散步', role: 'member' },
  {
    key: 'moderator',
    email: 'moderator@community.example.test',
    name: '社区版主',
    role: 'moderator',
  },
  { key: 'admin', email: 'manager@community.example.test', name: '社区管理员', role: 'admin' },
];
for (const demo of integrated ? [] : demos) {
  let id = store.state().emailIndex[demo.email];
  if (!id) id = (await registerWithEmail(demo.email, config.demoPassword, demo.name)).user.id;
  // Bootstrap roles once. Later changes by an administrator survive restarts.
  db.prepare('INSERT OR IGNORE INTO community_accounts(user_id,role) VALUES (?,?)').run(
    id,
    demo.role,
  );
}
if (!integrated) store.saveStrict();

// Upgrade only the two untouched official previews through the existing sync queue.
const seedReviewer = db
  .prepare(
    "SELECT user_id id FROM community_accounts WHERE role='admin' AND status='active' LIMIT 1",
  )
  .get() as { id: string } | undefined;
if (seedReviewer)
  for (const seed of seeds.filter((s) => s.worldbook || s.theme)) {
    const current = repo.resource(seed.id);
    if (
      current?.ownerId !== 'official-editor' ||
      current.status !== 'published' ||
      current.liveVersion !== '0.1.0'
    )
      continue;
    if (
      db
        .prepare(
          "SELECT 1 FROM community_sync WHERE resource_id=? AND version=? AND action='publish'",
        )
        .get(seed.id, seed.version)
    )
      continue;
    repo.job(seed.id, seed.version, 'publish', seedReviewer.id);
    repo.audit(seedReviewer.id, 'resource.upgrade-official-preview', seed.id, {
      from: '0.1.0',
      to: seed.version,
    });
  }
type Session = {
  hash: string;
  userId: string;
  yelanToken: string;
  expires: number;
  account: Account;
};
function sessionByHash(key: string): Session | null {
  const row = db
    .prepare(
      'SELECT hash,user_id userId,yelan_token yelanToken,expires FROM community_sessions WHERE hash=? AND expires>?',
    )
    .get(key, Date.now()) as Omit<Session, 'account'> | undefined;
  if (!row) return null;
  const u = getUserByToken(row.yelanToken);
  if (
    !u ||
    u.id !== row.userId ||
    u.deletedAt ||
    parseTokenVersion(row.yelanToken) !== (u.tokenVersion ?? 0)
  )
    return null;
  const account = repo.account(u.id);
  if (account.status !== 'active') return null;
  return { ...row, account };
}
function identity(userId: string) {
  if (userId === 'official-editor')
    return { externalId: userId, name: '夜阑编辑部', role: 'member', status: 'active' };
  const u = getUserById(userId);
  const a = repo.account(userId);
  if (!u || u.deletedAt || a.status !== 'active') fail(403, '账号已停用或被封禁');
  return {
    externalId: u.id,
    name: u.nickname || u.name || '夜阑用户',
    role: a.role,
    status: a.status,
    avatar: u.avatarUrl || '',
  };
}
const rateWindows = new Map<string, { count: number; until: number }>();
function rate(key: string, limit: number, milliseconds: number) {
  const t = Date.now();
  if (rateWindows.size > 5000)
    for (const [k, v] of rateWindows) if (v.until < t) rateWindows.delete(k);
  const row = rateWindows.get(key);
  if (!row || row.until < t) {
    rateWindows.set(key, { count: 1, until: t + milliseconds });
    return;
  }
  if (++row.count > limit) fail(429, '操作过于频繁，请稍后再试');
}
const app = new Hono<{ Variables: { userId: string; session: Session } }>();
app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ message: err.message }, err.status);
  console.error('[community-prototype]', err.message);
  return c.json({ message: '操作失败，请稍后重试' }, 500);
});
app.use(
  '/api/*',
  (c,next)=>bodyLimit({
    maxSize: integrated&&c.req.path.startsWith('/api/phone/')
      ? /\/inspection\/assets\//.test(c.req.path)
        ? c.req.header('content-type')?.startsWith('image/')?INSPECTION_IMAGE_INPUT_LIMIT:INSPECTION_ASSET_LIMIT
        : 4*1024*1024
      : 100000,
    onError: (context) => context.json({ message: c.req.path.startsWith('/api/phone/')?'小手机资源超过允许大小':'资源文件不能超过 100 KB' }, 413),
  })(c,next),
);
app.use('/api/*', async (c, next) => {
  if (c.req.method !== 'GET') {
    const from = c.req.header('origin');
    if ((from && from !== origin) || c.req.header('sec-fetch-site') === 'cross-site')
      return c.json({ message: '请从夜阑社区页面操作' }, 403);
  }
  c.header('Cache-Control', 'no-store');
  await next();
});
app.use('/api/private/*', async (c, next) => {
  const s = sessionByHash(hash(getCookie(c, 'yl_community_session') || ''));
  if (!s) return c.json({ message: '请重新登录，账号状态或会话可能已变化' }, 401);
  c.set('session', s);
  c.set('userId', s.userId);
  await next();
});
function manager(session: Session) {
  if (!['moderator', 'admin'].includes(session.account.role)) fail(403, '需要版主或管理员权限');
}
function owned(id: string, userId: string) {
  const r = repo.resource(id);
  if (!r) fail(404, '资源不存在');
  if (r.ownerId !== userId) fail(403, '只能修改自己发布的资源');
  return r;
}
function safeResource(r: Resource, version = r.liveVersion) {
  const rev = version && repo.revision(r.id, version);
  if (!rev) return null;
  const { payload: _payload, ...data } = rev.data;
  const u = getUserById(r.ownerId);
  return {
    ...data,
    author: u?.nickname || u?.name || data.author,
    ownerId: r.ownerId,
    status: r.status,
    tid: r.tid,
    revisionStatus: rev.status,
    preview: characterPreview(rev.data, true),
  };
}
async function forumRequest<T = Record<string, unknown>>(
  action: string,
  data: unknown,
): Promise<T> {
  try {
    const r = await fetch(`${forumInternal}/api/yelan-local/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Yelan-Bridge': config.bridgeSecret },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(15000),
    });
    const body = (await r.json()) as T & { message?: string };
    if (!r.ok) fail(r.status === 403 ? 403 : 503, body.message || '论坛操作暂不可用');
    return body;
  } catch (e) {
    if (e instanceof HTTPException) throw e;
    return fail(503, '论坛暂不可用，请稍后重试');
  }
}
let initialForum: Promise<{ version: string }> | null = null;
async function ensureForum() {
  if (!initialForum)
    initialForum = forumRequest<{
      topics: Record<string, { tid: number; pid: number }>;
      version: string;
    }>('seed', {
      resources: seeds.map((r) => ({
        id: r.id,
        title: r.topicTitle,
        content: `${r.content}\n\n[查看资源并应用](${origin}/#resource/${r.id})`,
        type: r.type,
      })),
    })
      .then((info) => {
        for (const [id, t] of Object.entries(info.topics))
          db.prepare('UPDATE community_resources SET tid=?,pid=? WHERE id=? AND tid IS NULL').run(
            t.tid,
            t.pid,
            id,
          );
        return info;
      })
      .catch((e) => {
        initialForum = null;
        throw e;
      });
  return initialForum;
}
async function applyForumStates() {
  await ensureForum();
  const list = repo.list().filter((r) => r.status === 'published' && r.tid);
  if (!list.length) return;
  const info = await forumRequest<{ items: { id: string; deleted: boolean; changed: boolean }[] }>(
    'resource-states',
    { ids: list.map((r) => r.id) },
  );
  for (const item of info.items)
    if (item.deleted || item.changed) {
      const reason = item.deleted ? '关联帖子已删除，需重新审核' : '论坛主帖已修改，需重新审核';
      if (
        db
          .prepare(
            "UPDATE community_resources SET status='offline',reason=?,updated_at=? WHERE id=? AND status='published'",
          )
          .run(reason, now(), item.id).changes
      )
        repo.audit('forum', 'resource.auto-offline', item.id, { reason });
    }
}
let syncing = false;
async function syncJobs() {
  if (syncing) return;
  syncing = true;
  try {
    await ensureForum();
    // Process oldest first, bounded retries. Failed jobs need explicit administrator retry.
    const jobs = repo.pendingJobs();
    for (const queuedJob of jobs) {
      const job = repo.claimJob(queuedJob.id);
      if (!job) continue;
      try {
        const r = repo.resource(job.resourceId)!;
        const revision = repo.revision(r.id, job.version)!;
        const result = await forumRequest<{ tid: number; pid: number }>('resource-sync', {
          action: job.action,
          id: r.id,
          tid: r.tid,
          owner: job.action === 'offline' ? { externalId: r.ownerId } : identity(r.ownerId),
          actor: identity(job.actorId),
          title: revision.data.topicTitle,
          content: `${revision.data.content}\n\n[查看资源并应用](${origin}/#resource/${r.id})`,
        });
        db.transaction(() => {
          if (job.action === 'publish') {
            db.prepare(
              "UPDATE community_resources SET status='published',live_version=?,tid=?,pid=?,reason='',updated_at=? WHERE id=?",
            ).run(job.version, result.tid, result.pid, now(), r.id);
            db.prepare(
              "UPDATE community_revisions SET status='published' WHERE resource_id=? AND version=?",
            ).run(r.id, job.version);
          }
          db.prepare("UPDATE community_sync SET status='done',error='' WHERE id=?").run(job.id);
          repo.audit(job.actorId, `resource.${job.action}.synced`, r.id, {
            version: job.version,
            tid: result.tid,
          });
        })();
      } catch (e) {
        const error = e instanceof Error ? e.message : '同步失败';
        db.prepare('UPDATE community_sync SET status=?,error=? WHERE id=?').run(
          job.attempts >= 5 ? 'failed' : 'pending',
          error,
          job.id,
        );
        repo.audit('system', 'sync.failed', job.resourceId, {
          jobId: job.id,
          error,
          attempt: job.attempts,
        });
      }
    }
  } finally {
    syncing = false;
  }
}
const syncTimer = setInterval(() => void syncJobs().catch(() => {}), 10000);
syncTimer.unref();

async function makeSession(userId: string, yelanToken: string) {
  if (repo.account(userId).status !== 'active') fail(403, '账号已停用或被封禁');
  const token = randomBytes(32).toString('base64url');
  db.prepare(
    'INSERT INTO community_sessions(hash,user_id,yelan_token,expires) VALUES (?,?,?,?)',
  ).run(hash(token), userId, yelanToken, Date.now() + 86400000);
  store.saveStrict();
  return token;
}
const cookieScope = {
  path: '/',
  ...(process.env.COMMUNITY_COOKIE_DOMAIN ? { domain: process.env.COMMUNITY_COOKIE_DOMAIN } : {}),
  secure: origin.startsWith('https://'),
};
const cookieOptions = { ...cookieScope, httpOnly: true, sameSite: 'Lax' as const, maxAge: 86400 };
async function replaceCookie(c: Context, userId: string, token: string) {
  const old = getCookie(c, 'yl_community_session');
  if (old) {
    db.prepare('DELETE FROM community_sessions WHERE hash=?').run(hash(old));
    await forumRequest('revoke-session', { hash: hash(old) }).catch(() => {});
  }
  setCookie(c, 'yl_community_session', await makeSession(userId, token), cookieOptions);
}
app.get('/api/health', async (c) => {
  try {
    const info = await ensureForum();
    await forumRequest('ping', {});
    return c.json({ account: true, forum: true, version: info.version });
  } catch {
    return c.json({ account: true, forum: false, version: null });
  }
});
app.get('/api/account-mode', (c) => c.json({ integrated, mainOrigin: process.env.COMMUNITY_MAIN_ORIGIN || 'https://yetland.cn' }));
// Start on the community origin so the one-use handoff is bound to this browser.
const handoffs = new Map<string, { token: string; challenge: string; expires: number }>();
app.get('/account/start', (c) => {
  if (!integrated) return c.redirect('/');
  const nonce = randomBytes(32).toString('base64url');
  setCookie(c, 'yl_community_handoff', nonce, { ...cookieOptions, maxAge: 300 });
  c.header('Cache-Control', 'no-store');
  c.header('Referrer-Policy', 'no-referrer');
  return c.redirect(`${process.env.COMMUNITY_MAIN_ORIGIN || 'https://yetland.cn'}/?community=${hash(nonce)}`);
});
export function issueCommunityHandoff(token: string, challenge: string) {
  const user = getUserByToken(token);
  if (!integrated || !user || user.deletedAt || user.isGuest || parseTokenVersion(token) !== (user.tokenVersion ?? 0))
    fail(401, '请先登录夜阑账号');
  if (!/^[a-f0-9]{64}$/.test(challenge)) fail(400, '登录请求无效，请从社区重新进入');
  if (repo.account(user.id).status !== 'active') fail(403, '社区账号已停用');
  rate(`handoff:${user.id}`, 30, 600000);
  for (const [key, value] of handoffs) if (value.expires < Date.now()) handoffs.delete(key);
  const ticket = randomBytes(32).toString('base64url');
  handoffs.set(hash(ticket), { token, challenge, expires: Date.now() + 120000 });
  return { url: `${origin}/account/complete?ticket=${ticket}` };
}
app.get('/account/complete', async (c) => {
  c.header('Cache-Control', 'no-store');
  c.header('Referrer-Policy', 'no-referrer');
  const key = hash(c.req.query('ticket') || '');
  const handoff = handoffs.get(key);
  handoffs.delete(key);
  const nonce = getCookie(c, 'yl_community_handoff') || '';
  deleteCookie(c, 'yl_community_handoff', cookieScope);
  const user = handoff && getUserByToken(handoff.token);
  if (!handoff || handoff.expires < Date.now() || hash(nonce) !== handoff.challenge || !user || user.deletedAt || parseTokenVersion(handoff.token) !== (user.tokenVersion ?? 0))
    return c.text('登录链接已过期或不属于当前浏览器，请返回社区重新登录。', 401);
  await replaceCookie(c, user.id, handoff.token);
  repo.audit(user.id, 'account.main-handoff', user.id);
  return c.redirect('/');
});
app.get('/api/resources', async (c) => {
  let forumAvailable = true;
  try {
    await applyForumStates();
  } catch {
    forumAvailable = false;
  }
  return c.json({
    resources: repo
      .list()
      .filter((r) => r.status === 'published')
      .map((r) => safeResource(r))
      .filter(Boolean),
    forumAvailable,
  });
});
app.get('/api/discussions', async (c) => c.json(await forumRequest('discussions', {})));
app.get('/api/resources/:id/preview', async (c) => {
  await applyForumStates();
  const resource = repo.resource(c.req.param('id'));
  if (!resource || resource.status !== 'published' || !resource.liveVersion)
    fail(404, '资源未发布或已下架');
  const revision = repo.revision(resource.id, resource.liveVersion);
  if (!revision || revision.status !== 'published') fail(404, '资源尚未发布');
  c.header('Cache-Control', 'no-store');
  return c.json({
    id: resource.id,
    version: resource.liveVersion,
    type: revision.data.type,
    character: characterPreview(revision.data),
  });
});
app.post('/api/demo-login', async (c) => {
  if (integrated) fail(403, '请使用夜阑账号登录');
  rate('demo-login', 100, 600000);
  const { account } = parse(z.object({ account: z.string() }), await c.req.json());
  const demo = demos.find((d) => d.key === account);
  if (!demo) fail(400, '请选择本地体验账号');
  const id = store.state().emailIndex[demo.email]!;
  if (repo.account(id).status !== 'active') fail(403, '此体验账号已停用或被封禁');
  const { user, token } = await loginWithEmail(demo.email, config.demoPassword);
  await replaceCookie(c, user.id, token);
  return c.json({ id: user.id, name: user.name, role: repo.account(user.id).role });
});
app.post('/api/login', async (c) => {
  rate('password-login', 40, 600000);
  const body = parse(
    z.object({ email: z.string().email().max(254), password: z.string().min(1).max(200) }),
    await c.req.json(),
  );
  try {
    const { user, token } = await loginWithEmail(body.email, body.password);
    await replaceCookie(c, user.id, token);
    return c.json({ id: user.id });
  } catch (e) {
    if (e instanceof HTTPException) throw e;
    fail(401, '邮箱或密码错误，或账号暂时不可用');
  }
});
app.post('/api/register', async (c) => {
  if (integrated) fail(403, '请在夜阑主站注册账号');
  rate('register', 12, 600000);
  const body = parse(
    z.object({
      email: z.string().email().max(254),
      password: z.string().min(8).max(200),
      name: z.string().trim().min(2).max(20),
      consent: z.literal(true),
    }),
    await c.req.json(),
  );
  try {
    const { user, token } = await registerWithEmail(body.email, body.password, body.name);
    repo.account(user.id);
    await replaceCookie(c, user.id, token);
    repo.audit(user.id, 'account.register', user.id);
    return c.json({ id: user.id }, 201);
  } catch (e) {
    if (e instanceof HTTPException) throw e;
    fail(400, e instanceof Error ? e.message : '注册失败');
  }
});
app.post('/api/logout', async (c) => {
  const key = hash(getCookie(c, 'yl_community_session') || '');
  const s = sessionByHash(key);
  db.prepare('DELETE FROM community_sessions WHERE hash=?').run(key);
  deleteCookie(c, 'yl_community_session', cookieScope);
  if (s) {
    repo.audit(s.userId, 'account.logout', s.userId);
    await forumRequest('revoke-session', { hash: key }).catch(() => {});
  }
  return c.json({ ok: true });
});
app.get('/api/private/me', (c) => {
  const u = getUserById(c.get('userId'))!;
  return c.json({ ...identity(u.id), id: u.id, email: u.email });
});
app.post('/api/private/profile', async (c) => {
  const { name } = parse(z.object({ name: z.string().trim().min(2).max(20) }), await c.req.json());
  const u = getUserById(c.get('userId'))!;
  u.nickname = name;
  store.saveStrict();
  repo.audit(u.id, 'account.profile', u.id, { name });
  await forumRequest('identity-sync', { identity: identity(u.id) }).catch(() => {});
  return c.json({ ok: true });
});
app.post('/api/private/account/delete', async (c) => {
  if (integrated) fail(403, '正式账号请在夜阑主站管理，社区不提供账号注销');
  if (c.get('session').account.role === 'admin') fail(409, '管理员需先移交权限');
  const body = parse(z.object({ currentPassword: z.string().min(1).max(200) }), await c.req.json());
  try {
    await deleteAccount(c.get('userId'), body);
  } catch {
    fail(400, '当前密码不正确');
  }
  db.prepare("UPDATE community_accounts SET status='deleted' WHERE user_id=?").run(c.get('userId'));
  db.prepare('DELETE FROM community_sessions WHERE user_id=?').run(c.get('userId'));
  store.saveStrict();
  repo.audit(c.get('userId'), 'account.deleted', c.get('userId'));
  await forumRequest('account-state', {
    externalId: c.get('userId'),
    status: 'deleted',
    reason: '账号已注销',
  }).catch(() => {});
  deleteCookie(c, 'yl_community_session', cookieScope);
  return c.json({ ok: true });
});
app.get('/api/private/library', (c) =>
  c.json({
    assets: assets.list(c.get('userId')),
    bindings: assets.bindings(c.get('userId')),
    activeTheme: assets.theme(c.get('userId')),
    characters: charactersService
      .listCreatedBy(c.get('userId'))
      .map(({ id, name, visibility, customPayload }) => ({ id, name, visibility, customPayload })),
    installations: db
      .prepare(
        'SELECT resource_id resourceId,version,character_id characterId,installed_at installedAt FROM installations WHERE user_id=?',
      )
      .all(c.get('userId')),
  }),
);
app.post('/api/private/assets/:id/bind', async (c) => {
  const { characterId } = parse(z.object({ characterId: z.string().min(1) }), await c.req.json());
  const result = assets.bind(c.get('userId'), c.req.param('id'), characterId);
  repo.audit(c.get('userId'), 'worldbook.bind', c.req.param('id'), { characterId });
  return c.json(result);
});
app.post('/api/private/assets/:id/unbind', async (c) => {
  const { characterId } = parse(z.object({ characterId: z.string().min(1) }), await c.req.json());
  assets.unbind(c.get('userId'), c.req.param('id'), characterId);
  repo.audit(c.get('userId'), 'worldbook.unbind', c.req.param('id'), { characterId });
  return c.json({ ok: true });
});
app.post('/api/private/themes/activate', async (c) => {
  const { id } = parse(z.object({ id: z.string().nullable() }), await c.req.json());
  const result = assets.activate(c.get('userId'), id);
  repo.audit(c.get('userId'), id ? 'theme.activate' : 'theme.restore', id || 'original');
  return c.json(result);
});

// A short-lived phone-only capability. It cannot authenticate community APIs.
const phoneSessions = new Map<string, { parent: string; expires: number }>();
app.post('/api/private/phone-session', (c) => {
  for (const [key, s] of phoneSessions) if (s.expires < Date.now()) phoneSessions.delete(key);
  const token = randomBytes(32).toString('base64url');
  phoneSessions.set(hash(token), {
    parent: c.get('session').hash,
    expires: Date.now() + 30 * 60000,
  });
  return c.json({ token, url: phoneOrigin });
});
app.use('/api/auth/me', async (c, next) => {
  await authenticatePhone(c, next);
});
app.use('/api/phone/*', async (c, next) => {
  await authenticatePhone(c, next);
});
async function authenticatePhone(c: Context, next: () => Promise<void>) {
  const token = c.req.header('authorization')?.replace(/^Bearer /, '') || '';
  const capability = phoneSessions.get(hash(token));
  const session = capability && capability.expires > Date.now() && sessionByHash(capability.parent);
  if (!session) throw new HTTPException(401, { message: '请从社区重新进入小手机' });
  c.set('userId', session.userId);
  c.set('session', session);
  await next();
}
app.get('/api/auth/me', (c) => c.json({ id: c.get('userId') }));
app.get('/api/phone/bootstrap', (c) => {
  const userId = c.get('userId');
  return c.json({
    userId,
    managed: true,
    imageGeneration: false,
    inspectionEnabled: integrated,
    communityTheme: assets.theme(userId),
    characters: charactersService
      .listCreatedBy(userId)
      .filter((r) => r.isActive && r.visibility === 'private')
      .map((r) => ({
        id: r.id,
        name: r.name,
        persona: communityPhonePersona(r),
        avatar: null,
        updatedAt: r.updatedAt,
        canEdit: true,
        rules: PhoneRoleRulesSchema.parse(charactersService.getRow(r.id)?.phoneRules || {}),
      })),
  });
});
app.get('/api/phone/characters/:id/rules', (c) => {
  const row = charactersService.getRow(c.req.param('id'));
  if (!row || row.ownerUserId !== c.get('userId') || row.visibility !== 'private')
    fail(403, '没有角色权限');
  return c.json({
    characterId: row.id,
    canEdit: true,
    rules: PhoneRoleRulesSchema.parse(row.phoneRules || {}),
  });
});
app.put('/api/phone/characters/:id/rules', async (c) => {
  const row = charactersService.getRow(c.req.param('id'));
  if (!row || row.ownerUserId !== c.get('userId') || row.visibility !== 'private')
    fail(403, '没有角色权限');
  row.phoneRules = parse(PhoneRoleRulesSchema, await c.req.json());
  row.updatedAt = now();
  store.saveStrict();
  return c.json({ characterId: row.id, canEdit: true, rules: row.phoneRules });
});
app.all('/api/phone/*', async (c) => {
  if (integrated) {
    // The capability is checked above, then exchanged only inside this process.
    // Never return the full account token or expose unrelated API routes.
    const { phoneRoute } = await import('../routes/phone');
    const url = new URL(c.req.url);
    url.pathname = url.pathname.replace(/^\/api\/phone/, '') || '/';
    const headers = new Headers(c.req.raw.headers);
    headers.set('authorization', `Bearer ${c.get('session').yelanToken}`);
    return phoneRoute.fetch(new Request(url, {
      method: c.req.method, headers,
      ...(!['GET', 'HEAD'].includes(c.req.method) ? { body: await c.req.arrayBuffer() } : {}),
      signal: c.req.raw.signal,
    }));
  }
  return c.json(
    { code: 'PHONE_MODEL_UNAVAILABLE', message: '本地社区未连接模型服务，请使用主站进行真实对话' },
    503,
  );
});

app.post('/api/private/install/:id', async (c) => {
  await applyForumStates();
  const resource = repo.resource(c.req.param('id'));
  if (!resource || resource.status !== 'published' || !resource.liveVersion)
    fail(404, '资源未发布或已下架');
  const r = repo.revision(resource.id, resource.liveVersion)!.data;
  const userId = c.get('userId');
  if (!r.installable) fail(409, '此资源目前仅提供预览');
  if (r.type !== 'character') {
    const body = parse(z.object({ characterId: z.string().min(1).optional() }), await c.req.json());
    // Validate the target before creating a receipt, including ownership.
    if (r.type === 'worldbook') {
      if (!body.characterId) fail(400, '请选择需要绑定世界书的私有角色');
      const row = charactersService.getRow(body.characterId);
      if (!row || row.ownerUserId !== userId || row.visibility !== 'private' || !row.isActive)
        fail(403, '请选择自己的私有角色');
    }
    const result = assets.install(userId, r);
    if (r.type === 'worldbook') assets.bind(userId, result.asset.id, body.characterId!);
    if (r.type === 'theme') assets.activate(userId, result.asset.id);
    repo.audit(userId, 'resource.install', r.id, {
      version: r.version,
      assetId: result.asset.id,
      characterId: body.characterId,
    });
    return c.json({ ...result, name: r.title }, result.alreadyInstalled ? 200 : 201);
  }
  if (!r.payload) fail(409, '角色内容不存在');
  const existing = db
    .prepare(
      'SELECT character_id characterId FROM installations WHERE user_id=? AND resource_id=? AND version=?',
    )
    .get(userId, r.id, r.version) as { characterId: string } | undefined;
  const existingRow = existing && charactersService.getRow(existing.characterId);
  if (existingRow?.ownerUserId === userId && existingRow.visibility === 'private' && existingRow.isActive)
    return c.json({
      characterId: existingRow.id,
      name: r.payload.name,
      alreadyInstalled: true,
    });
  const marker = `夜阑社区本地原型 · ${r.id}@${r.version}`;
  const character =
    charactersService
      .listCreatedBy(userId)
      .find(
        (row) =>
          (row.customPayload as UserCharacterCreate | undefined)?.worldbook?.notes === marker,
      ) ||
    charactersService.createFromUser(userId, {
      ...r.payload,
      makePublic: false,
      worldbook: { ...r.payload.worldbook, notes: marker },
    });
  store.saveStrict();
  db.prepare('INSERT OR REPLACE INTO installations VALUES (?,?,?,?,?)').run(
    userId,
    r.id,
    r.version,
    character.id,
    now(),
  );
  repo.audit(userId, 'resource.install', r.id, { version: r.version, characterId: character.id });
  return c.json({ characterId: character.id, name: character.name, alreadyInstalled: false }, 201);
});
app.get('/api/resources/:id/discussion', async (c) => {
  await applyForumStates();
  const r = repo.resource(c.req.param('id'));
  if (!r || r.status !== 'published' || !r.tid) fail(404, '资源未发布或已下架');
  const page = Math.max(1, Math.min(100, Number(c.req.query('page')) || 1));
  return c.json(await forumRequest('discussion', { id: r.id, page }));
});
app.post('/api/private/reply/:id', async (c) => {
  rate(`reply:${c.get('userId')}`, 1, 2000);
  await applyForumStates();
  const r = repo.resource(c.req.param('id'));
  if (!r || r.status !== 'published') fail(404, '资源未发布或已下架');
  const body = parse(z.object({ content: z.string().trim().min(2).max(3000) }), await c.req.json());
  return c.json(
    await forumRequest('reply', {
      identity: identity(c.get('userId')),
      tid: r.tid,
      content: body.content,
    }),
    201,
  );
});
app.post('/api/private/vote/:pid', async (c) => {
  const pid = parse(z.coerce.number().int().positive(), c.req.param('pid'));
  const { enabled } = parse(z.object({ enabled: z.boolean() }), await c.req.json());
  return c.json(await forumRequest('vote', { identity: identity(c.get('userId')), pid, enabled }));
});
app.get('/api/private/vote-status/:pid', async (c) =>
  c.json(
    await forumRequest('vote-status', {
      identity: identity(c.get('userId')),
      pid: parse(z.coerce.number().int().positive(), c.req.param('pid')),
    }),
  ),
);

function newRevision(
  body: z.infer<typeof SubmissionSchema>,
  id: string,
  userId: string,
): PrototypeResource {
  return {
    id,
    type: body.type,
    title: body.title,
    subtitle: body.subtitle,
    description: body.description,
    tags: body.tags,
    version: body.version,
    author: identity(userId).name,
    color: body.type === 'character' ? 'sage' : body.type === 'worldbook' ? 'blue' : 'moss',
    glyph: body.title.slice(0, 1),
    topicTitle: `分享｜${body.title}`,
    content: body.description,
    installable: true,
    ...(body.payload ? { payload: { ...body.payload, makePublic: false } } : {}),
    ...(body.worldbook ? { worldbook: body.worldbook } : {}),
    ...(body.theme ? { theme: body.theme } : {}),
  };
}
const versionNumber = (s: string) => s.split('.').reduce((n, v) => n * 10000 + Number(v), 0);
app.get('/api/private/resources', (c) =>
  c.json({
    resources: repo
      .list()
      .filter((r) => r.ownerId === c.get('userId'))
      .map((r) => ({ ...r, revisions: repo.revisions(r.id) })),
  }),
);
app.post('/api/private/resources', async (c) => {
  rate(`submission:${c.get('userId')}`, 12, 600000);
  const body = parse(SubmissionSchema, await c.req.json());
  const id = `res-${randomUUID()}`;
  let source: { tid: number; pid: number } | undefined;
  if (body.sourceTid) {
    if (repo.list().some((r) => r.tid === body.sourceTid)) fail(409, '此帖子已经关联资源');
    source = await forumRequest('source-topic', {
      tid: body.sourceTid,
      identity: identity(c.get('userId')),
    });
  }
  db.transaction(() => {
    db.prepare(
      "INSERT INTO community_resources(id,owner_id,status,tid,pid,updated_at) VALUES (?,?,'draft',?,?,?)",
    ).run(id, c.get('userId'), source?.tid || null, source?.pid || null, now());
    db.prepare(
      "INSERT INTO community_revisions(resource_id,version,status,json,created_at) VALUES (?,?,'draft',?,?)",
    ).run(id, body.version, JSON.stringify(newRevision(body, id, c.get('userId'))), now());
    repo.audit(c.get('userId'), 'resource.draft', id, {
      version: body.version,
      sourceTid: source?.tid,
    });
  })();
  return c.json({ id, version: body.version }, 201);
});
app.post('/api/private/resources/:id/versions', async (c) => {
  const r = owned(c.req.param('id'), c.get('userId'));
  const body = parse(SubmissionSchema, await c.req.json());
  const revisions = repo.revisions(r.id);
  if (body.type !== revisions[0]!.data.type) fail(400, '新版本不能更改资源类型');
  if (revisions.some((v) => versionNumber(v.version) >= versionNumber(body.version)))
    fail(409, '新版本号必须高于已有版本');
  db.prepare(
    "INSERT INTO community_revisions(resource_id,version,status,json,created_at) VALUES (?,?,'draft',?,?)",
  ).run(r.id, body.version, JSON.stringify(newRevision(body, r.id, c.get('userId'))), now());
  repo.audit(c.get('userId'), 'resource.version', r.id, { version: body.version });
  return c.json({ id: r.id, version: body.version }, 201);
});
app.post('/api/private/resources/:id/submit', async (c) => {
  const r = owned(c.req.param('id'), c.get('userId'));
  const { version } = parse(z.object({ version: z.string() }), await c.req.json());
  const changes = db
    .prepare(
      "UPDATE community_revisions SET status='pending',reason='' WHERE resource_id=? AND version=? AND status='draft'",
    )
    .run(r.id, version).changes;
  if (!changes) fail(409, '仅草稿可以提交审核');
  repo.audit(c.get('userId'), 'resource.submit', r.id, { version });
  return c.json({ ok: true });
});
async function offline(r: Resource, actorId: string, reason: string) {
  if (!r.liveVersion) fail(409, '资源尚未发布');
  if (db.prepare("SELECT 1 FROM community_sync WHERE resource_id=? AND status='running'").get(r.id))
    fail(409, '资源正在同步，请稍后再下架');
  db.transaction(() => {
    db.prepare(
      "UPDATE community_sync SET status='cancelled',error='资源已下架，取消待发布任务' WHERE resource_id=? AND action='publish' AND status IN ('pending','failed')",
    ).run(r.id);
    db.prepare(
      "UPDATE community_resources SET status='offline',reason=?,updated_at=? WHERE id=?",
    ).run(reason, now(), r.id);
    repo.job(r.id, r.liveVersion!, 'offline', actorId);
    repo.audit(actorId, 'resource.offline', r.id, { reason });
  })();
  await syncJobs();
}
app.post('/api/private/resources/:id/offline', async (c) => {
  const r = owned(c.req.param('id'), c.get('userId'));
  const { reason } = parse(
    z.object({ reason: z.string().trim().min(2).max(400) }),
    await c.req.json(),
  );
  await offline(r, c.get('userId'), reason);
  return c.json({ ok: true });
});
app.get('/api/private/manage', (c) => {
  manager(c.get('session'));
  const accounts = Object.values(store.state().users)
    .filter((u) => !u.isGuest)
    .map((u) => ({
      ...repo.account(u.id),
      name: u.nickname || u.name,
      ...(c.get('session').account.role === 'admin' ? { email: u.email } : {}),
      deleted: Boolean(u.deletedAt),
    }));
  return c.json({
    resources: repo.list().map((r) => ({ ...r, revisions: repo.revisions(r.id) })),
    accounts,
    jobs: repo.jobs(),
    audit: db
      .prepare(
        'SELECT id,actor_id actorId,action,target,detail,created_at createdAt FROM community_audit ORDER BY id DESC LIMIT 150',
      )
      .all(),
  });
});
app.post('/api/private/review/:id', async (c) => {
  manager(c.get('session'));
  const r = repo.resource(c.req.param('id'));
  if (!r) fail(404, '资源不存在');
  const body = parse(
    z.object({
      version: z.string(),
      decision: z.enum(['approve', 'reject', 'offline', 'republish']),
      reason: z.string().trim().max(400).default(''),
    }),
    await c.req.json(),
  );
  if (body.decision === 'offline') {
    if (body.reason.length < 2) fail(400, '请填写下架原因');
    await offline(r, c.get('userId'), body.reason);
    return c.json({ ok: true });
  }
  if (r.ownerId === c.get('userId')) fail(403, '不能审核自己的资源，请交由其他版主处理');
  const revision = repo.revision(r.id, body.version);
  if (!revision) fail(404, '版本不存在');
  if (body.decision === 'reject') {
    if (body.reason.length < 2) fail(400, '请填写驳回原因');
    if (revision.status !== 'pending') fail(409, '版本已不在待审状态');
    db.prepare(
      "UPDATE community_revisions SET status='rejected',reason=? WHERE resource_id=? AND version=?",
    ).run(body.reason, r.id, body.version);
    repo.audit(c.get('userId'), 'resource.reject', r.id, body);
    return c.json({ ok: true });
  }
  if (body.decision === 'approve' && revision.status !== 'pending') fail(409, '版本已不在待审状态');
  if (
    body.decision === 'republish' &&
    (r.status !== 'offline' || revision.status !== 'published' || r.liveVersion !== body.version)
  )
    fail(409, '仅可恢复已发布后下架的版本');
  if (
    db
      .prepare(
        "SELECT 1 FROM community_sync WHERE resource_id=? AND status IN ('pending','running','failed')",
      )
      .get(r.id)
  )
    fail(409, '此资源仍有同步任务，请先处理');
  if (r.liveVersion && versionNumber(body.version) < versionNumber(r.liveVersion))
    fail(409, '不能将旧版本覆盖到新版本');
  db.transaction(() => {
    db.prepare(
      "UPDATE community_revisions SET status='approved' WHERE resource_id=? AND version=?",
    ).run(r.id, body.version);
    repo.job(r.id, body.version, 'publish', c.get('userId'));
    repo.audit(c.get('userId'), 'resource.approve', r.id, body);
  })();
  await syncJobs();
  return c.json({
    ok: true,
    status: repo.resource(r.id)!.status,
    jobs: repo.jobs().filter((j) => j.resourceId === r.id),
  });
});
app.post('/api/private/manage/jobs/:id/retry', async (c) => {
  manager(c.get('session'));
  const job = repo.jobs().find((j) => j.id === c.req.param('id'));
  if (!job) fail(404, '任务不存在');
  if (!['pending', 'failed'].includes(job.status)) fail(409, '任务不需要重试');
  db.prepare("UPDATE community_sync SET status='pending',attempts=0,actor_id=? WHERE id=?").run(
    c.get('userId'),
    job.id,
  );
  repo.audit(c.get('userId'), 'sync.retry', job.id);
  await syncJobs();
  return c.json({ ok: true });
});
app.post('/api/private/manage/jobs/:id/cancel', async (c) => {
  manager(c.get('session'));
  const job = repo.jobs().find((j) => j.id === c.req.param('id'));
  if (!job) fail(404, '任务不存在');
  if (!['pending', 'failed'].includes(job.status) || job.action !== 'publish')
    fail(409, '仅可取消未完成的发布任务');
  db.transaction(() => {
    db.prepare("UPDATE community_sync SET status='cancelled' WHERE id=?").run(job.id);
    db.prepare(
      "UPDATE community_revisions SET status='rejected',reason='管理员取消发布同步' WHERE resource_id=? AND version=? AND status='approved'",
    ).run(job.resourceId, job.version);
    repo.audit(c.get('userId'), 'sync.cancel', job.id);
  })();
  return c.json({ ok: true });
});
app.post('/api/private/manage/accounts/:id', async (c) => {
  manager(c.get('session'));
  const id = c.req.param('id');
  const u = getUserById(id);
  if (!u) fail(404, '账号不存在');
  const body = parse(
    z.object({
      role: z.enum(['member', 'moderator', 'admin']).optional(),
      status: z.enum(['active', 'banned']).optional(),
      reason: z.string().trim().min(2).max(400),
    }),
    await c.req.json(),
  );
  const old = repo.account(id);
  if (body.role && c.get('session').account.role !== 'admin') fail(403, '仅管理员可分配角色');
  if (c.get('session').account.role === 'moderator' && old.role !== 'member')
    fail(403, '版主只能管理普通成员');
  if (id === c.get('userId')) fail(403, '不能修改自己的管理权限或封禁自己');
  if (u.deletedAt || old.status === 'deleted') fail(409, '已注销账号不能恢复为活跃账号');
  db.transaction(() => {
    db.prepare('UPDATE community_accounts SET role=?,status=?,reason=? WHERE user_id=?').run(
      body.role || old.role,
      body.status || old.status,
      body.reason,
      id,
    );
    if (body.status === 'banned' || body.role)
      db.prepare('DELETE FROM community_sessions WHERE user_id=?').run(id);
    repo.audit(c.get('userId'), 'account.manage', id, { before: old, after: body });
  })();
  // Authoritative state is already durable. All forum requests and sockets revalidate it.
  let synced = true;
  try {
    await forumRequest('account-state', {
      externalId: id,
      status: body.status || old.status,
      role: body.role || old.role,
      reason: body.reason,
      identity: (body.status || old.status) === 'active' ? identity(id) : undefined,
    });
  } catch {
    synced = false;
  }
  return c.json({ ok: true, synced });
});

const tickets = new Map<string, { sessionHash: string; expires: number; path: string }>();
const pathSchema = z
  .string()
  .max(500)
  .regex(/^\/(?:$|(?:topic|category|admin|recent|unread|post-queue|flags)(?:[/?][^\\]*)?$)/);
app.post('/api/private/forum-session', async (c) => {
  await ensureForum();
  const body = await c.req.json().catch(() => ({}));
  const path = body.path ? parse(pathSchema, body.path) : '/category/5';
  for (const [key, t] of tickets) if (t.expires < Date.now()) tickets.delete(key);
  const ticket = randomBytes(32).toString('base64url');
  tickets.set(ticket, { sessionHash: c.get('session').hash, expires: Date.now() + 30000, path });
  return c.json({ url: `${forumOrigin}/yelan/login?ticket=${encodeURIComponent(ticket)}` });
});
const exchangeApp = new Hono();
exchangeApp.use('/internal/*', async (c, next) => {
  const a = Buffer.from(c.req.header('x-yelan-bridge') || '');
  const b = Buffer.from(config.bridgeSecret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return c.json({ message: '拒绝访问' }, 403);
  c.header('Cache-Control', 'no-store');
  await next();
});
exchangeApp.post('/internal/session', async (c) => {
  const body = await c.req.json<{ token?: string; hash?: string }>();
  const s = sessionByHash(body.hash || hash(body.token || ''));
  if (!s) return c.json({ message: '会话已失效' }, 401);
  return c.json({ ...identity(s.userId), sessionHash: s.hash });
});
exchangeApp.post('/internal/exchange', async (c) => {
  const { ticket } = await c.req.json<{ ticket: string }>();
  const t = tickets.get(ticket);
  tickets.delete(ticket);
  const s = t && t.expires > Date.now() ? sessionByHash(t.sessionHash) : null;
  if (!s || !t) return c.json({ message: '登录链接已过期' }, 401);
  return c.json({ ...identity(s.userId), sessionHash: s.hash, path: t.path });
});
exchangeApp.post('/internal/logout', async (c) => {
  const body = await c.req.json<{ hash: string }>();
  const s = sessionByHash(body.hash);
  db.prepare('DELETE FROM community_sessions WHERE hash=?').run(body.hash);
  if (s) repo.audit(s.userId, 'account.logout.forum', s.userId);
  return c.json({ ok: true });
});
exchangeApp.post('/internal/event', async (c) => {
  const event = await c.req.json<{
    id: string;
    kind: string;
    resourceId?: string;
    externalId?: string;
    actor?: string;
    reason?: string;
  }>();
  if (db.prepare('SELECT id FROM community_events WHERE id=?').get(event.id))
    return c.json({ ok: true });
  db.transaction(() => {
    if (event.resourceId && ['topic.delete', 'topic.edit', 'topic.restore'].includes(event.kind)) {
      db.prepare(
        "UPDATE community_resources SET status='offline',reason=?,updated_at=? WHERE id=? AND live_version IS NOT NULL",
      ).run('论坛内容发生变更，需重新审核', now(), event.resourceId);
    }
    if (
      event.externalId &&
      ['account.ban', 'account.unban', 'account.delete'].includes(event.kind)
    ) {
      const a = repo.account(event.externalId);
      if (a.role !== 'admin') {
        db.prepare('UPDATE community_accounts SET status=?,reason=? WHERE user_id=?').run(
          event.kind === 'account.ban'
            ? 'banned'
            : event.kind === 'account.delete'
              ? 'deleted'
              : 'active',
          event.reason || '论坛管理操作',
          event.externalId,
        );
        db.prepare('DELETE FROM community_sessions WHERE user_id=?').run(event.externalId);
      }
    }
    repo.audit(
      event.actor || 'forum',
      `forum.${event.kind}`,
      event.resourceId || event.externalId || '',
      event,
    );
    db.prepare('INSERT INTO community_events VALUES (?,?)').run(event.id, now());
  })();
  return c.json({ ok: true });
});
app.use('/*', serveStatic({ root: resolve(root, 'prototype/community/public') }));
app.get('*', serveStatic({ path: resolve(root, 'prototype/community/public/index.html') }));
const server = serve({
  fetch: app.fetch,
  port: 3038,
  hostname: process.env.COMMUNITY_LISTEN_HOST || '127.0.0.1',
});
const exchangeServer = serve({ fetch: exchangeApp.fetch, port: 3039, hostname: '0.0.0.0' });
server.on('listening', () => console.log(`Community prototype: ${origin}`));
process.on('SIGTERM', () => {
  clearInterval(syncTimer);
  db.close();
  server.close();
  exchangeServer.close();
});
