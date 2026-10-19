'use strict';
const communityOrigin = process.env.COMMUNITY_PUBLIC_ORIGIN || 'http://localhost:3038';
const forumOrigin = process.env.COMMUNITY_FORUM_ORIGIN || 'http://localhost:4567';
// Adapt the cloned prototype's rendered links without editing reviewed source posts.
exports.adaptPrototypeLinks = async (data) => {
  if (typeof data.postData?.content === 'string') {
    for (const [from, to] of [['http://localhost:3038', communityOrigin], ['http://localhost:4567', forumOrigin]]) {
      data.postData.content = data.postData.content.split(`href="${from}/`).join(`href="${to}/`);
    }
  }
  return data;
};
const { createHash, randomUUID, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const db = require.main.require('./src/database');
const user = require.main.require('./src/user');
const groups = require.main.require('./src/groups');
const categories = require.main.require('./src/categories');
const topics = require.main.require('./src/topics');
const posts = require.main.require('./src/posts');
const privileges = require.main.require('./src/privileges');
const api = require.main.require('./src/api');
const sockets = require.main.require('./src/socket.io');
const authentication = require.main.require('./src/controllers/authentication');
const version = require.main.require('./package.json').version;
const secret = process.env.YELAN_BRIDGE_SECRET;
const pendingUsers = new Map();
const suppressed = new Set();
const digest = (s) => createHash('sha256').update(s).digest('hex');
const contentHash = (title, content) => digest(`${title}\n${content}`);
const escape = (s) =>
  String(s || '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
async function bridge(action, body) {
  const r = await fetch(`http://bridge:3039/internal/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Yelan-Bridge': secret },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  if (r.status === 401) return null;
  if (!r.ok) throw new Error('夜阑账号服务暂不可用');
  return r.json();
}
async function ensureUser(identity) {
  if (
    !identity ||
    typeof identity.externalId !== 'string' ||
    !identity.externalId ||
    typeof identity.name !== 'string' ||
    identity.status !== 'active' ||
    !['member', 'moderator', 'admin'].includes(identity.role)
  )
    throw new Error('账号已停用或身份无效');
  const key = identity.externalId;
  // Serialize creation and role updates for parallel assets/API requests.
  const previous = pendingUsers.get(key) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      const hash = digest(key).slice(0, 12);
      const mapKey = `yelan-local:user:${hash}`;
      const cached = await db.getObject(mapKey);
      let uid = Number(cached?.uid);
      if (uid && cached.externalId !== key) throw new Error('Identity mapping collision');
      if (uid && !(await user.exists(uid))) throw new Error('论坛账号已删除，请联系管理员');
      if (!uid) {
        const username = `${identity.name.replace(/[^\p{L}\p{N}_]/gu, '').slice(0, 12) || '夜阑用户'}_${hash.slice(0, 4)}`;
        uid = Number(await user.getUidByUsername(username));
        if (uid && (await user.getUserField(uid, 'yelanExternalId')) !== key)
          throw new Error('Username is linked to another account');
        if (!uid) uid = Number(await user.create({ username, fullname: identity.name }));
        await user.setUserFields(uid, { yelanExternalId: key, 'email:confirmed': 1 });
        await db.setObject(mapKey, { uid, externalId: key });
      }
      await db.setObject(`yelan-local:uid:${uid}`, { externalId: key });
      const info = await user.getUserFields(uid, ['fullname', 'banned', 'yelanRole']);
      if (Number(info.banned)) throw new Error('此论坛账号已被封禁');
      if (info.fullname !== identity.name) await user.setUserField(uid, 'fullname', identity.name);
      for (const [name, enabled] of [
        ['administrators', identity.role === 'admin'],
        ['Global Moderators', identity.role === 'moderator'],
      ]) {
        const member = await groups.isMember(uid, name);
        if (enabled && !member) await groups.join(name, uid);
        if (!enabled && member) await groups.leave(name, uid);
      }
      if (info.yelanRole !== identity.role)
        await user.setUserField(uid, 'yelanRole', identity.role);
      return uid;
    });
  pendingUsers.set(key, next);
  try {
    return await next;
  } finally {
    if (pendingUsers.get(key) === next) pendingUsers.delete(key);
  }
}
const authorized = (req) => {
  const a = Buffer.from(req.get('x-yelan-bridge') || '');
  const b = Buffer.from(secret || '');
  return !!secret && a.length === b.length && timingSafeEqual(a, b);
};
const internal = (handler) => async (req, res) => {
  if (!authorized(req)) return res.status(403).json({ message: 'Bridge access denied' });
  try {
    res.json(await handler(req.body));
  } catch (e) {
    console.error('[yelan-local]', e.message);
    res.status(403).json({ message: e.message });
  }
};
async function logout(req) {
  if (req.user) await promisify(req.logout).call(req);
  req.uid = 0;
  req.loggedIn = false;
  if (req.session) delete req.session.yelanHash;
}
async function syncRequest(req, res, next) {
  try {
    const path = req.path || '';
    if (
      /^\/(assets|plugins|uploads|socket\.io)\//.test(path) ||
      path === '/favicon.ico' ||
      (path.startsWith('/api/yelan-local/') && authorized(req))
    )
      return next();
    if (req.headers.authorization)
      return res.status(403).json({ message: '请使用夜阑统一账号会话访问论坛' });
    if (req.method === 'GET' && /^\/user\/[^/]+\/(?:edit|settings)(?:\/|$)/.test(path))
      return res.redirect(`${communityOrigin}/?account=1`);
    if (/^\/(?:api\/v3\/utilities\/)?(?:register|login|reset)(?:\/|$)/.test(path)) {
      if (req.method === 'GET') return res.redirect(`${communityOrigin}/?account=1`);
      return res.status(403).json({ message: '请在夜阑社区注册或登录' });
    }
    const token = req.cookies?.yl_community_session;
    const current = token ? await bridge('session', { token }) : null;
    if (!current) {
      await logout(req);
      return next();
    }
    const uid = await ensureUser(current);
    if (Number(req.uid) !== uid || req.session?.yelanHash !== current.sessionHash) {
      await authentication.doLogin(req, uid);
      req.session.yelanHash = current.sessionHash;
      await promisify(req.session.save).call(req.session);
    }
    next();
  } catch (e) {
    res.status(503).json({ message: e.message || '夜阑账号服务暂不可用' });
  }
}
exports.validateSocket = async ({ socket, session }) => {
  if (!socket.uid) return;
  const current = session?.yelanHash ? await bridge('session', { hash: session.yelanHash }) : null;
  if (!current || Number(await ensureUser(current)) !== Number(socket.uid)) {
    socket.emit('event:invalid_session');
    socket.disconnect(true);
    throw new Error('[[error:invalid-session]]');
  }
};
exports.loggedOut = async ({ req, res }) => {
  const token = req.cookies?.yl_community_session;
  if (token) await bridge('logout', { hash: digest(token) });
  res.clearCookie('yl_community_session', { path: '/' });
};
exports.logoutDestination = async (data) => {
  data.next = `${communityOrigin}/`;
  return data;
};
async function mapping(id) {
  return db.getObject(`yelan-local:resource:${id}`);
}
let seedPromise;
async function seed(data) {
  let cid = Number(await db.getObjectField('yelan-local:settings', 'cid'));
  if (!cid) {
    const c = await categories.create({
      name: '夜阑资源与灵感',
      description: '资源分享与玩法交流；可从页顶发布资源，审核后进入资源广场。',
      icon: 'fa-leaf',
      bgColor: '#456b50',
      color: '#fff',
    });
    cid = c.cid;
    await db.setObject('yelan-local:settings', { cid });
  }
  const uid = await ensureUser({
    externalId: 'official-editor',
    name: '夜阑编辑部',
    role: 'member',
    status: 'active',
  });
  await categories.setCategoryField(cid, 'postQueue', 1);
  const result = {};
  for (const r of data.resources) {
    let t = await mapping(r.id);
    if (!t?.tid) {
      const p = await topics.post({
        uid,
        cid,
        title: r.title,
        content: r.content,
        ip: '127.0.0.1',
      });
      t = { tid: p.topicData.tid, pid: p.postData.pid };
    }
    await db.setObject(`yelan-local:resource:${r.id}`, {
      ...t,
      ...(!t.hash ? { hash: contentHash(r.title, r.content) } : {}),
    });
    await db.setObject(`yelan-local:topic:${t.tid}`, { id: r.id });
    result[r.id] = { tid: Number(t.tid), pid: Number(t.pid) };
  }
  await db.setObject('yelan-local:catalog', { json: JSON.stringify(result) });
  return { topics: result, version };
}
async function resourceSync(data) {
  const actor = await ensureUser(data.actor);
  let t = await mapping(data.id);
  let tid = Number(t?.tid || data.tid);
  if (data.action === 'publish' && !['admin', 'moderator'].includes(data.actor.role))
    throw new Error('发布需要审核权限');
  if (
    data.action === 'offline' &&
    data.actor.externalId !== data.owner.externalId &&
    !['admin', 'moderator'].includes(data.actor.role)
  )
    throw new Error('没有下架权限');
  if (tid) suppressed.add(tid);
  try {
    if (data.action === 'offline') {
      if (tid && !Number(await topics.getTopicField(tid, 'deleted')))
        await api.topics.delete({ uid: actor, ip: '127.0.0.1' }, { tids: [tid] });
      return { tid, pid: Number(t?.pid || (await topics.getTopicField(tid, 'mainPid'))) };
    }
    if (!tid) {
      const owner = await ensureUser(data.owner);
      const cid = Number(await db.getObjectField('yelan-local:settings', 'cid'));
      const p = await topics.post({
        uid: owner,
        cid,
        title: data.title,
        content: data.content,
        ip: '127.0.0.1',
      });
      tid = p.topicData.tid;
      t = { tid, pid: p.postData.pid };
      suppressed.add(tid);
      // Save the stable mapping before any later step can fail.
      await db.setObject(`yelan-local:resource:${data.id}`, t);
    } else {
      const pid = Number(await topics.getTopicField(tid, 'mainPid'));
      if (Number(await topics.getTopicField(tid, 'deleted')))
        await api.topics.restore({ uid: actor, ip: '127.0.0.1' }, { tids: [tid] });
      await api.posts.edit(
        { uid: actor, ip: '127.0.0.1' },
        { pid, title: data.title, content: data.content },
      );
      t = { tid, pid };
    }
    await db.setObject(`yelan-local:resource:${data.id}`, {
      ...t,
      hash: contentHash(data.title, data.content),
    });
    await db.setObject(`yelan-local:topic:${tid}`, { id: data.id });
    return { tid, pid: Number(t.pid) };
  } finally {
    suppressed.delete(tid);
  }
}
let draining = false;
async function drainEvents() {
  if (draining) return;
  draining = true;
  try {
    const ids = await db.getSortedSetRange('yelan-local:events', 0, 24);
    for (const id of ids) {
      const row = await db.getObject(`yelan-local:event:${id}`);
      if (!row?.json) continue;
      await bridge('event', JSON.parse(row.json));
      await db.sortedSetRemove('yelan-local:events', id);
      await db.delete(`yelan-local:event:${id}`);
    }
  } finally {
    draining = false;
  }
}
async function queueEvent(event) {
  const id = randomUUID();
  await db.setObject(`yelan-local:event:${id}`, { json: JSON.stringify({ id, ...event }) });
  await db.sortedSetAdd('yelan-local:events', Date.now(), id);
  void drainEvents().catch(() => {});
}
async function topicEvent(data, kind) {
  const tid = Number(data.topic?.tid || data.post?.tid);
  if (!tid || suppressed.has(tid)) return;
  const r = await db.getObject(`yelan-local:topic:${tid}`);
  if (!r?.id) return;
  if (data.post && Number(await topics.getTopicField(tid, 'mainPid')) !== Number(data.post.pid))
    return;
  await queueEvent({ kind, resourceId: r.id, actor: `forum:${data.uid || 0}` });
}
exports.topicDeleted = (data) => topicEvent(data, 'topic.delete');
exports.topicRestored = (data) => topicEvent(data, 'topic.restore');
exports.postEdited = (data) => topicEvent(data, 'topic.edit');
async function accountEvent(data, kind) {
  const id =
    (await db.getObjectField(`yelan-local:uid:${data.uid}`, 'externalId')) ||
    data.user?.yelanExternalId ||
    (await user.getUserField(data.uid, 'yelanExternalId'));
  if (id)
    await queueEvent({
      kind,
      externalId: id,
      actor: `forum:${data.callerUid || 0}`,
      reason: data.reason || '',
    });
}
exports.accountBanned = (data) => accountEvent(data, 'account.ban');
exports.accountUnbanned = (data) => accountEvent(data, 'account.unban');
exports.accountDeleted = (data) => accountEvent(data, 'account.delete');
exports.profileGuard = async (data) => {
  if (await user.getUserField(data.data?.uid, 'yelanExternalId'))
    throw new Error('请在夜阑社区的账号设置中修改资料');
  return data;
};
exports.renderHeader = async (data) => {
  const widgets = data.templateData.widgets || {};
  data.templateData.widgets = {
    ...widgets,
    'brand-header': [
      {
        html: `<div class="d-flex gap-2 flex-wrap justify-content-end"><a id="yelan-publish" class="btn btn-sm btn-success text-nowrap" href="${communityOrigin}/?publish=1" data-ajaxify="false">发布资源</a><a id="yelan-community-back" class="btn btn-sm btn-outline-success text-nowrap" href="${communityOrigin}/" data-ajaxify="false"><i class="fa fa-arrow-left me-1" aria-hidden="true"></i>返回夜阑社区</a></div>`,
      },
      ...(widgets['brand-header'] || []),
    ],
  };
  return data;
};
exports.init = async ({ app, router }) => {
  app.use(syncRequest);
  router.get('/api/yelan-local/session-status', (req, res) =>
    res.json({
      uid: req.uid || 0,
      role: req.user?.yelanRole || '',
      hash: req.session?.yelanHash || '',
    }),
  );
  router.post(
    '/api/yelan-local/ping',
    internal(async () => ({ version })),
  );
  router.post(
    '/api/yelan-local/seed',
    internal((data) => {
      if (!seedPromise)
        seedPromise = seed(data).catch((e) => {
          seedPromise = null;
          throw e;
        });
      return seedPromise;
    }),
  );
  router.post(
    '/api/yelan-local/identity-sync',
    internal(async (data) => ({ uid: await ensureUser(data.identity) })),
  );
  router.post(
    '/api/yelan-local/revoke-session',
    internal(async (data) => {
      const all = await sockets.server.fetchSockets();
      for (const s of all)
        if (s.request?.session?.yelanHash === data.hash) {
          s.emit('event:invalid_session');
          s.disconnect(true);
        }
      return { ok: true };
    }),
  );
  router.post(
    '/api/yelan-local/account-state',
    internal(async (data) => {
      const m = await db.getObject(`yelan-local:user:${digest(data.externalId).slice(0, 12)}`);
      if (!m?.uid) return { ok: true };
      const uid = Number(m.uid);
      if (data.status !== 'active') {
        await user.bans.ban(uid, 0, data.reason || '社区账号已停用');
        await user.auth.revokeAllSessions(uid);
        sockets.in(`uid_${uid}`).disconnectSockets(true);
      } else {
        if (Number(await user.getUserField(uid, 'banned')))
          await user.bans.unban(uid, data.reason || '解除封禁');
        if (data.identity) await ensureUser(data.identity);
      }
      return { ok: true };
    }),
  );
  router.post('/api/yelan-local/resource-sync', internal(resourceSync));
  router.post(
    '/api/yelan-local/resource-states',
    internal(async (data) => ({
      items: await Promise.all(
        data.ids.map(async (id) => {
          const m = await mapping(id);
          if (!m?.tid) return { id, deleted: true, changed: false };
          const t = await topics.getTopicFields(m.tid, ['tid', 'title', 'deleted']);
          const body = await posts.getPostField(m.pid, 'content');
          return {
            id,
            deleted: !t.tid || Boolean(Number(t.deleted)),
            changed: contentHash(t.title, body) !== m.hash,
          };
        }),
      ),
    })),
  );
  router.post(
    '/api/yelan-local/source-topic',
    internal(async (data) => {
      const uid = await ensureUser(data.identity);
      const t = await topics.getTopicFields(data.tid, ['tid', 'uid', 'mainPid', 'cid', 'deleted']);
      if (
        Number(t.uid) !== uid ||
        Number(t.deleted) ||
        Number(t.cid) !== Number(await db.getObjectField('yelan-local:settings', 'cid'))
      )
        throw new Error('只能关联本人在资源版块发布的有效帖子');
      if (await db.getObjectField(`yelan-local:topic:${data.tid}`, 'id'))
        throw new Error('帖子已经关联资源');
      return { tid: Number(t.tid), pid: Number(t.mainPid) };
    }),
  );
  router.post(
    '/api/yelan-local/discussions',
    internal(async () => {
      const cid = await db.getObjectField('yelan-local:settings', 'cid');
      const ids = await db.getSortedSetRevRange(`cid:${cid}:tids`, 0, 29);
      const list = await topics.getTopicsFields(ids, [
        'tid',
        'title',
        'uid',
        'deleted',
        'postcount',
        'lastposttime',
      ]);
      const items = [];
      for (const t of list)
        if (t.tid && !Number(t.deleted) && (await privileges.topics.can('topics:read', t.tid, 0))) {
          const u = await user.getUserFields(t.uid, ['username', 'fullname']);
          items.push({
            tid: Number(t.tid),
            title: t.title,
            name: u.fullname || u.username,
            postcount: Number(t.postcount),
            timestamp: Number(t.lastposttime),
            url: `${forumOrigin}/topic/${t.tid}`,
            resourceId: (await db.getObjectField(`yelan-local:topic:${t.tid}`, 'id')) || null,
          });
        }
      return { topics: items };
    }),
  );
  router.post(
    '/api/yelan-local/discussion',
    internal(async (data) => {
      const m = await mapping(data.id);
      if (
        !m?.tid ||
        !(await privileges.topics.can('topics:read', m.tid, 0)) ||
        Number(await topics.getTopicField(m.tid, 'deleted'))
      )
        throw new Error('讨论不可用');
      const start = (data.page - 1) * 20;
      const all = await topics.getPids(m.tid);
      const ids =
        data.page === 1 ? all.slice(0, 20) : [Number(m.pid), ...all.slice(start, start + 20)];
      const raw = await posts.getPostsByPids(ids, 0);
      const list = [];
      for (const p of raw)
        if (p && !Number(p.deleted)) {
          const u = await user.getUserFields(p.uid, ['username', 'fullname']);
          list.push({
            pid: Number(p.pid),
            html: p.content,
            timestamp: Number(p.timestamp),
            votes: Number(p.votes) || 0,
            name: u.fullname || u.username,
          });
        }
      return {
        tid: Number(m.tid),
        pid: Number(m.pid),
        posts: list,
        page: data.page,
        hasMore: start + 20 < all.length,
        forumUrl: `${forumOrigin}/topic/${m.tid}`,
      };
    }),
  );
  router.post(
    '/api/yelan-local/reply',
    internal(async (data) => {
      const uid = await ensureUser(data.identity);
      const r = await api.topics.reply(
        { uid, ip: '127.0.0.1' },
        { tid: Number(data.tid), content: data.content },
      );
      return { ok: true, queued: Boolean(r.queued), pid: r.pid || r.posts?.[0]?.pid };
    }),
  );
  router.post(
    '/api/yelan-local/vote',
    internal(async (data) => {
      const uid = await ensureUser(data.identity);
      const status = await posts.hasVoted(Number(data.pid), uid);
      if (data.enabled && !status.upvoted) await posts.upvote(Number(data.pid), uid);
      if (!data.enabled && status.upvoted) await posts.unvote(Number(data.pid), uid);
      return { ok: true, upvoted: Boolean(data.enabled) };
    }),
  );
  router.post(
    '/api/yelan-local/vote-status',
    internal(async (data) => posts.hasVoted(Number(data.pid), await ensureUser(data.identity))),
  );
  router.get('/yelan/login', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (typeof req.query.ticket !== 'string') return res.status(400).send('请从夜阑社区登录');
      const current = await bridge('exchange', { ticket: req.query.ticket });
      if (!current) return res.status(401).send('登录链接已失效，请返回夜阑社区');
      const uid = await ensureUser(current);
      await authentication.doLogin(req, uid);
      req.session.yelanHash = current.sessionHash;
      req.session.save((e) =>
        e ? res.status(500).send('登录失败') : res.redirect(current.path || '/'),
      );
    } catch (e) {
      res.status(503).send(escape(e.message));
    }
  });
  const timer = setInterval(() => void drainEvents().catch(() => {}), 5000);
  timer.unref();
};
