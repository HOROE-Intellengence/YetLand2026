'use strict';
let authRegister = false;
let publisherPayload = null;
let workspaceTab = 'resources';
let workspaceData = null;
let publisherPending = false;
const roleName = (r) => ({ member: '成员', moderator: '版主', admin: '管理员' })[r] || r;
const statusName = (s) =>
  ({
    draft: '草稿',
    pending: '待审核',
    approved: '已批准 · 同步中',
    rejected: '已驳回',
    published: '已发布',
    offline: '已下架',
    active: '正常',
    banned: '已封禁',
    deleted: '已注销',
    done: '已同步',
    running: '同步中',
    failed: '同步失败',
    cancelled: '已取消',
  })[s] || s;
async function action(button, fn) {
  button.disabled = true;
  try {
    await fn();
  } catch (e) {
    toast(e.message);
  } finally {
    button.disabled = false;
  }
}
function showWorkspace(title) {
  $('#workspace-title').textContent = title;
  if (!$('#workspace-dialog').open) $('#workspace-dialog').showModal();
}
function creatorName(id) {
  return (
    workspaceData?.accounts?.find((a) => a.userId === id)?.name ||
    (id === 'official-editor' ? '夜阑编辑部' : id)
  );
}
$('#auth-toggle').onclick = () => {
  authRegister = !authRegister;
  $('#register-name-label').hidden = !authRegister;
  $('#register-consent-label').hidden = !authRegister;
  $('#auth-form').elements.name.required = authRegister;
  $('#auth-form').elements.consent.required = authRegister;
  $('#auth-submit').textContent = authRegister ? '注册并登录' : '登录';
  $('#auth-toggle').textContent = authRegister ? '已有账号，去登录' : '注册本地账号';
  $('#auth-form').elements.password.autocomplete = authRegister
    ? 'new-password'
    : 'current-password';
};
$('#auth-form').onsubmit = (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  action($('#auth-submit'), async () => {
    await api(authRegister ? '/api/register' : '/api/login', {
      method: 'POST',
      body: JSON.stringify({
        email: f.elements.email.value,
        password: f.elements.password.value,
        ...(authRegister
          ? { name: f.elements.name.value, consent: f.elements.consent.checked }
          : {}),
      }),
    });
    f.elements.password.value = '';
    await refreshAccount();
    $('#account-dialog').close();
    toast('已登录社区与论坛');
    await window.communityAfterLogin();
  });
};
$('#profile-form').onsubmit = (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  action(f.querySelector('button'), async () => {
    await api('/api/private/profile', {
      method: 'POST',
      body: JSON.stringify({ name: f.elements.name.value }),
    });
    await refreshAccount();
    toast('昵称已保存，论坛同步使用此昵称');
  });
};
function updateType() {
  const character = $('#publisher-form').elements.type.value === 'character';
  $('#character-fields').hidden = !character;
  $('#publisher-form').elements.characterName.required = character;
  $('#publisher-form').elements.background.required = character;
  $('#package-fields').hidden = character;
  if (!character) {
    const type = $('#publisher-form').elements.type.value;
    $('#package-json').value = JSON.stringify(
      type === 'worldbook'
        ? {
            schema: 'yelan-worldbook',
            schemaVersion: 1,
            entries: [
              {
                key: '雨城',
                content: '雨城的末班车在午夜停靠旧车站。',
                constant: true,
                useRegex: false,
                position: 'after_char',
              },
            ],
          }
        : {
            schema: 'yelan-phone-theme',
            schemaVersion: 1,
            name: '苔绿手记',
            cssOverrides: {
              '--c-header-bg': '#f7f5ef',
              '--c-page-body-bg': '#e8eee5',
              '--c-text-title': '#26332c',
              '--c-text': '#526b58',
              '--c-icon-active': '#526b58',
              '--c-bubble-self': '#d7e4d1',
            },
            fontFamily: 'system',
          },
      null,
      2,
    );
  }
}
function openPublisher(resource, revision, sourceTid) {
  if (!requireLogin()) {
    publisherPending = true;
    return;
  }
  const form = $('#publisher-form');
  form.reset();
  publisherPayload = revision?.data.payload ? structuredClone(revision.data.payload) : null;
  form.elements.resourceId.value = resource?.id || '';
  form.elements.sourceTid.value = sourceTid || '';
  if (revision) {
    const d = revision.data;
    for (const key of ['title', 'subtitle', 'description', 'type'])
      form.elements[key].value = d[key];
    form.elements.version.value = d.version.replace(/\d+$/, (n) => String(Number(n) + 1));
    form.elements.tags.value = d.tags.join('，');
    form.elements.characterName.value = d.payload?.name || '';
    form.elements.background.value = d.payload?.worldbook?.background || '';
  }
  form.elements.type.disabled = Boolean(resource);
  $('#publisher-title').textContent = resource ? '发布一个新版本' : '发布一份资源';
  $('#publisher-source').textContent = sourceTid
    ? `将关联你在论坛发布的帖子 #${sourceTid}，审核前不会进入资源广场。`
    : resource
      ? '新版本审核期间，已发布版本继续可用。已有私有副本保留。'
      : '角色卡加入私有角色库，世界书绑定角色，主题应用至小手机。';
  updateType();
  if (revision?.data.worldbook || revision?.data.theme)
    $('#package-json').value = JSON.stringify(
      revision.data.worldbook || revision.data.theme,
      null,
      2,
    );
  if (!$('#publisher-dialog').open) $('#publisher-dialog').showModal();
}
$('#publisher-form').elements.type.onchange = updateType;
$('#package-file').onchange = async (e) => {
  try {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 100000) throw new Error('安装包不能超过100 KB');
    const data = JSON.parse(await file.text());
    $('#package-json').value = JSON.stringify(data.worldbook || data.theme || data, null, 2);
    toast('安装包已导入，请核对内容后保存');
  } catch (err) {
    toast(err.message);
  }
};
$('#resource-file').onchange = async (e) => {
  try {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 100000) throw new Error('JSON 文件不能超过 100 KB');
    const parsed = JSON.parse(await file.text());
    const p = parsed.payload || parsed;
    if (typeof p.name !== 'string' || !p.worldbook)
      throw new Error('请使用包含 name 与 worldbook 的夜阑角色 JSON');
    publisherPayload = p;
    $('#publisher-form').elements.characterName.value = p.name;
    $('#publisher-form').elements.background.value = p.worldbook.background || '';
    toast('角色内容已导入，请核对设定与分享权限');
  } catch (err) {
    toast(err.message);
  }
};
$('#publisher-form').onsubmit = (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const type = f.elements.type.value;
  let packageData;
  if (type !== 'character') {
    try {
      packageData = JSON.parse($('#package-json').value);
    } catch {
      toast('安装包JSON格式错误');
      return;
    }
  }
  const body = {
    type,
    title: f.elements.title.value,
    subtitle: f.elements.subtitle.value,
    description: f.elements.description.value,
    tags: f.elements.tags.value
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean),
    version: f.elements.version.value,
    consent: f.elements.consent.checked,
    ...(f.elements.sourceTid.value ? { sourceTid: Number(f.elements.sourceTid.value) } : {}),
    ...(type === 'character'
      ? {
          payload: {
            ...publisherPayload,
            name: f.elements.characterName.value,
            consent: true,
            makePublic: false,
            worldbook: { ...publisherPayload?.worldbook, background: f.elements.background.value },
          },
        }
      : { [type]: packageData }),
  };
  action(f.querySelector('[type=submit]'), async () => {
    await api(
      f.elements.resourceId.value
        ? `/api/private/resources/${f.elements.resourceId.value}/versions`
        : '/api/private/resources',
      { method: 'POST', body: JSON.stringify(body) },
    );
    $('#publisher-dialog').close();
    toast('草稿已保存，在“我的发布”中提交审核');
    await openSubmissions();
  });
};
function revisionDetails(v) {
  const p = v.data.payload;
  return `<details class="review-details"><summary>查看资源内容</summary><p>${escapeHtml(v.data.description)}</p>${p ? `<strong>${escapeHtml(p.name)}</strong><pre>${escapeHtml(JSON.stringify({ worldbook: p.worldbook, card: p.card }, null, 2))}</pre>` : `<pre>${escapeHtml(JSON.stringify(v.data.worldbook || v.data.theme || '旧版概念预览', null, 2))}</pre>`}</details>`;
}
async function openSubmissions() {
  if (!requireLogin()) return;
  const data = await api('/api/private/resources');
  showWorkspace('我的发布');
  $('#workspace-content').innerHTML =
    `<div class="workspace-toolbar"><p class="muted">每个版本单独审核，已安装的私有副本不会被覆盖。</p><button class="primary-button" id="new-submission">＋ 发布资源</button></div>` +
    (data.resources
      .map(
        (r) =>
          `<section class="work-card"><div class="work-heading"><h3>${escapeHtml(r.revisions[0].data.title)}</h3><span class="tag">${statusName(r.status)}</span></div>${r.reason ? `<p class="review-reason">${escapeHtml(r.reason)}</p>` : ''}${r.revisions.map((v) => `<div class="revision-row"><strong>v${v.version}</strong><span class="tag">${statusName(v.status)}</span>${v.reason ? `<p class="review-reason">${escapeHtml(v.reason)}</p>` : ''}${revisionDetails(v)}${v.status === 'draft' ? `<button class="primary-button" data-submit-resource="${r.id}" data-version="${v.version}">提交审核</button>` : ''}</div>`).join('')}<div class="work-actions"><button data-update-resource="${r.id}" class="text-button">发布新版本</button>${r.status === 'published' ? `<form data-own-offline="${r.id}"><input name="reason" required minlength="2" maxlength="400" placeholder="下架原因" aria-label="下架原因" /><button class="text-button" type="submit">下架资源</button></form>` : ''}</div></section>`,
      )
      .join('') || '<p class="empty-state">还没有发布资源，从一份喜欢的角色设定开始吧。</p>');
  $('#new-submission').onclick = () => openPublisher();
  for (const b of document.querySelectorAll('[data-submit-resource]'))
    b.onclick = () =>
      action(b, async () => {
        await api(`/api/private/resources/${b.dataset.submitResource}/submit`, {
          method: 'POST',
          body: JSON.stringify({ version: b.dataset.version }),
        });
        toast('已提交审核');
        await openSubmissions();
      });
  for (const b of document.querySelectorAll('[data-update-resource]'))
    b.onclick = () => {
      const r = data.resources.find((r) => r.id === b.dataset.updateResource);
      openPublisher(r, r.revisions[0]);
    };
  for (const f of document.querySelectorAll('[data-own-offline]'))
    f.onsubmit = (e) => {
      e.preventDefault();
      action(f.querySelector('button'), async () => {
        await api(`/api/private/resources/${f.dataset.ownOffline}/offline`, {
          method: 'POST',
          body: JSON.stringify({ reason: f.elements.reason.value }),
        });
        await refreshResources();
        await openSubmissions();
        toast('资源已下架；已安装的私有副本保留');
      });
    };
}
async function openManage(tab = workspaceTab) {
  if (!requireLogin()) return;
  workspaceTab = typeof tab === 'string' ? tab : 'resources';
  workspaceData = await api('/api/private/manage');
  showWorkspace('社区管理');
  renderManage();
}
function renderManage() {
  const d = workspaceData;
  const pending = d.resources.flatMap((r) =>
    r.revisions.filter((v) => v.status === 'pending'),
  ).length;
  $('#workspace-content').innerHTML =
    `<div class="workspace-toolbar"><span class="tag">${roleName(state.me.role)} · ${pending} 份资源待审</span><button class="text-button" id="forum-queue">帖子审核与举报 ↗</button>${state.me.role === 'admin' ? '<button class="text-button" id="forum-admin">论坛后台 ↗</button>' : ''}</div><div class="workspace-tabs">${[
      ['resources', '资源审核'],
      ['accounts', '账号与权限'],
      ['jobs', '同步任务'],
      ['audit', '操作记录'],
    ]
      .map(
        ([key, label]) =>
          `<button data-work-tab="${key}" class="${workspaceTab === key ? 'selected' : ''}">${label}</button>`,
      )
      .join('')}</div><div id="manage-panel"></div>`;
  $('#forum-queue').onclick = () => openForum('/post-queue');
  if ($('#forum-admin')) $('#forum-admin').onclick = () => openForum('/admin');
  for (const b of document.querySelectorAll('[data-work-tab]'))
    b.onclick = () => {
      workspaceTab = b.dataset.workTab;
      renderManage();
    };
  const panel = $('#manage-panel');
  if (workspaceTab === 'resources') {
    const rank = (r) =>
      r.revisions.some((v) => v.status === 'pending')
        ? 0
        : r.status === 'published'
          ? 1
          : r.status === 'offline'
            ? 2
            : 3;
    panel.innerHTML = d.resources
      .slice()
      .sort((a, b) => rank(a) - rank(b))
      .map(
        (r) =>
          `<section class="work-card"><div class="work-heading"><h3>${escapeHtml(r.revisions[0].data.title)}</h3><span class="tag">${statusName(r.status)}</span></div><p class="muted">作者：${escapeHtml(creatorName(r.ownerId))} · ${r.tid ? `论坛 #${r.tid}` : '尚未关联帖子'}</p>${r.reason ? `<p class="review-reason">${escapeHtml(r.reason)}</p>` : ''}${r.revisions
            .filter((v) => v.status === 'pending' || v.status === 'approved')
            .map(
              (v) =>
                `<div class="revision-row"><strong>v${v.version} · ${statusName(v.status)}</strong>${revisionDetails(v)}${v.status === 'pending' ? `<form class="review-form" data-review-id="${r.id}" data-version="${v.version}"><input name="reason" placeholder="审核意见；驳回时必填" maxlength="400" aria-label="审核意见" /><button class="primary-button" name="decision" value="approve" type="submit" ${r.ownerId === state.me.id ? 'disabled' : ''}>审核通过</button><button class="text-button" name="decision" value="reject" type="submit" ${r.ownerId === state.me.id ? 'disabled' : ''}>驳回</button></form>` : ''}</div>`,
            )
            .join(
              '',
            )}${r.liveVersion ? `<form class="review-form" data-review-id="${r.id}" data-version="${r.liveVersion}"><input name="reason" placeholder="${r.status === 'published' ? '下架原因' : '重新审核意见'}" maxlength="400" aria-label="管理原因" /><button type="submit" class="text-button" name="decision" value="${r.status === 'published' ? 'offline' : 'republish'}" ${r.status !== 'published' && r.ownerId === state.me.id ? 'disabled' : ''}>${r.status === 'published' ? '下架资源' : '复核并恢复上架'}</button>${r.tid ? `<button type="button" class="text-button" data-open-topic="${r.tid}">查看论坛帖子 ↗</button>` : ''}</form>` : ''}</section>`,
      )
      .join('');
    for (const f of panel.querySelectorAll('[data-review-id]'))
      f.onsubmit = (e) => {
        e.preventDefault();
        const decision = e.submitter.value;
        action(e.submitter, async () => {
          await api(`/api/private/review/${f.dataset.reviewId}`, {
            method: 'POST',
            body: JSON.stringify({
              version: f.dataset.version,
              decision,
              reason: f.elements.reason.value,
            }),
          });
          await refreshResources();
          await openManage('resources');
          toast('审核操作已记录，请留意同步任务状态');
        });
      };
    for (const b of panel.querySelectorAll('[data-open-topic]'))
      b.onclick = () => openForum(`/topic/${b.dataset.openTopic}`);
  } else if (workspaceTab === 'accounts') {
    panel.innerHTML = d.accounts
      .map(
        (a) =>
          `<section class="work-card"><div class="work-heading"><h3>${escapeHtml(a.name || '未命名用户')}</h3><span class="tag">${roleName(a.role)} · ${statusName(a.deleted ? 'deleted' : a.status)}</span></div>${state.me.role === 'admin' ? `<p class="muted">${escapeHtml(a.email || '')}</p>` : ''}<p class="review-reason">${escapeHtml(a.reason || '')}</p>${a.userId !== state.me.id && !a.deleted && a.status !== 'deleted' && (state.me.role === 'admin' || a.role === 'member') ? `<form class="review-form account-action" data-user-id="${a.userId}" data-role="${a.role}" data-status="${a.status}">${state.me.role === 'admin' ? `<label>角色<select name="role">${['member', 'moderator', 'admin'].map((role) => `<option value="${role}" ${a.role === role ? 'selected' : ''}>${roleName(role)}</option>`).join('')}</select></label>` : ''}<input name="reason" required minlength="2" maxlength="400" placeholder="操作原因" aria-label="账号操作原因" />${state.me.role === 'admin' ? '<button class="text-button" type="submit" name="action" value="role">保存角色</button>' : ''}<button class="text-button" type="submit" name="action" value="status">${a.status === 'active' ? '封禁账号' : '解除封禁'}</button></form>` : '<p class="muted">当前账号或受保护账号</p>'}</section>`,
      )
      .join('');
    for (const f of panel.querySelectorAll('[data-user-id]'))
      f.onsubmit = (e) => {
        e.preventDefault();
        const body = {
          reason: f.elements.reason.value,
          ...(e.submitter.value === 'role'
            ? { role: f.elements.role.value }
            : { status: f.dataset.status === 'active' ? 'banned' : 'active' }),
        };
        action(e.submitter, async () => {
          const result = await api(`/api/private/manage/accounts/${f.dataset.userId}`, {
            method: 'POST',
            body: JSON.stringify(body),
          });
          await openManage('accounts');
          toast(result.synced ? '账号状态已统一更新' : '账号已更新，论坛会在请求时重新校验身份');
        });
      };
  } else if (workspaceTab === 'jobs') {
    panel.innerHTML =
      '<p class="muted">同步成功才会上架。失败最多自动尝试 5 次，之后由管理员手动重试。</p>' +
      (d.jobs
        .map(
          (j) =>
            `<section class="work-card"><div class="work-heading"><strong>${escapeHtml(j.resourceId)} · v${j.version}</strong><span class="tag">${statusName(j.status)}</span></div><p>${j.action === 'publish' ? '发布关联帖子' : '下架关联帖子'} · 已尝试 ${j.attempts}/5</p>${j.error ? `<p class="review-reason">${escapeHtml(j.error)}</p>` : ''}${['failed', 'pending'].includes(j.status) ? `<button class="text-button" data-retry-job="${j.id}">重新同步</button>${j.action === 'publish' ? `<button class="text-button" data-cancel-job="${j.id}">取消发布任务</button>` : ''}` : ''}</section>`,
        )
        .join('') || '<p class="empty-state">暂时没有同步任务。</p>');
    for (const b of panel.querySelectorAll('[data-retry-job]'))
      b.onclick = () =>
        action(b, async () => {
          await api(`/api/private/manage/jobs/${b.dataset.retryJob}/retry`, {
            method: 'POST',
            body: '{}',
          });
          await openManage('jobs');
        });
    for (const b of panel.querySelectorAll('[data-cancel-job]'))
      b.onclick = () =>
        action(b, async () => {
          await api(`/api/private/manage/jobs/${b.dataset.cancelJob}/cancel`, {
            method: 'POST',
            body: '{}',
          });
          await openManage('jobs');
          toast('发布同步已取消，审核记录已保留');
        });
  } else {
    panel.innerHTML =
      d.audit
        .map(
          (a) =>
            `<div class="audit-row"><time>${new Date(a.createdAt).toLocaleString('zh-CN')}</time><strong>${escapeHtml(a.action)}</strong><span>${escapeHtml(creatorName(a.actorId))}</span><small>${escapeHtml(a.target)}</small><details><summary>查看详情</summary><pre>${escapeHtml(a.detail)}</pre></details></div>`,
        )
        .join('') || '<p class="empty-state">暂无记录。</p>';
  }
}
$('#publish-nav').onclick = () => openPublisher();
$('#submissions-nav').onclick = () => openSubmissions().catch((e) => toast(e.message));
$('#manage-nav').onclick = () => openManage().catch((e) => toast(e.message));
window.communityAfterLogin = async () => {
  await refreshResources();
  if (window.communityPendingForum) {
    const path = window.communityPendingForum;
    window.communityPendingForum = null;
    await openForum(path);
    return;
  }
  if (publisherPending) {
    publisherPending = false;
    openPublisher(
      null,
      null,
      Number(new URLSearchParams(location.search).get('topic')) || undefined,
    );
  }
};
window.communityAccountChanged = () => {
  workspaceData = null;
  publisherPayload = null;
};
window.communityReady = async () => {
  const params = new URLSearchParams(location.search);
  if (params.has('account')) chooseAccount();
  if (params.has('publish')) {
    if (state.me) openPublisher(null, null, Number(params.get('topic')) || undefined);
    else {
      publisherPending = true;
      chooseAccount();
    }
  }
};
