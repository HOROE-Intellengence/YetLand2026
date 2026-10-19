const state = {
  resources: [],
  me: null,
  library: [],
  installations: [],
  filter: 'all',
  search: '',
  selected: null,
  forum: false,
  liked: new Set(),
  topics: [],
  assets: [],
  bindings: [],
  activeTheme: null,
  integrated: false,
};
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const typeLabel = (type) => ({ character: '角色卡', worldbook: '世界书', theme: '小手机' })[type];
let toastTimer;
function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 3000);
}
async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.message || '操作失败，请重试。');
    error.status = response.status;
    throw error;
  }
  return body;
}
function art(resource) {
  return window.CommunityPreviews.card(state.resources.find((r) => r.id === resource.id) || resource);
}
function displayResource(r) {
  return {
    ...r,
    title: escapeHtml(r.title),
    subtitle: escapeHtml(r.subtitle),
    description: escapeHtml(r.description),
    author: escapeHtml(r.author),
    glyph: escapeHtml(r.glyph),
    tags: r.tags.map(escapeHtml),
  };
}
function installed(resource) {
  if (resource.type !== 'character')
    return state.assets.some((a) => a.resourceId === resource.id && a.version === resource.version);
  return state.installations.some(
    (item) =>
      item.resourceId === resource.id &&
      item.version === resource.version &&
      state.library.some((c) => c.id === item.characterId),
  );
}
function renderResources() {
  const items = state.resources.filter(
    (r) =>
      (state.filter === 'all' || r.type === state.filter) &&
      `${r.title} ${r.tags.join(' ')}`.includes(state.search),
  );
  $('#resource-total').textContent = String(items.length).padStart(2, '0');
  $('#resource-grid').innerHTML =
    items
      .map(displayResource)
      .map(
        (r) =>
          `<button class="resource-card" data-resource="${r.id}" aria-label="预览${typeLabel(r.type)}：${r.title}">${art(r)}<div class="resource-info"><div class="resource-title"><h3>${r.title}</h3><span>↗</span></div><p>${r.subtitle}</p><div class="card-tags">${r.tags
            .slice(0, 2)
            .map((t) => `<span class="tag">${t}</span>`)
            .join(
              '',
            )}</div><div class="card-bottom"><span class="card-author"><span class="tiny-avatar">阑</span>${r.author}</span><span class="${installed(r) ? 'install-state' : ''}">${installed(r) ? '✓ 已加入账户' : r.installable ? '↗ 一键应用' : '概念预览'}</span></div></div></button>`,
      )
      .join('') || '<div class="no-results">暂时没有匹配的资源，换个关键词试试。</div>';
  $('#topic-list').innerHTML = state.topics
    .map(
      (r, i) =>
        `<button class="topic-item" data-topic="${r.tid}"><span class="topic-number">${String(i + 1).padStart(2, '0')}</span><div><h4>${escapeHtml(r.title)}</h4><small>${escapeHtml(r.name)} · ${r.postcount} 条帖子${r.resourceId ? ' · 已关联资源' : ''}</small></div><span class="topic-arrow">↗</span></button>`,
    )
    .join('');
  for (const item of document.querySelectorAll('[data-topic]'))
    item.onclick = () => openForum(`/topic/${item.dataset.topic}`);
  for (const item of document.querySelectorAll('[data-resource]')) {
    item.onclick = () => openResource(item.dataset.resource);
  }
}
function renderAccount() {
  $('#account-name').textContent = state.me?.name || '体验账号';
  $('.user-avatar').textContent = state.me?.name?.slice(0, 1) || '访';
  $('#library-count').textContent = state.library.length + state.assets.length;
  $('#logout-button').hidden = !state.me;
  $('#manage-nav').hidden = !['moderator', 'admin'].includes(state.me?.role);
  $('#auth-form').hidden = Boolean(state.me);
  $('#profile-form').hidden = !state.me;
  if (state.me) $('#profile-form').elements.name.value = state.me.name;
  $('#welcome-login').innerHTML = state.me
    ? '查看我的资源 <span>→</span>'
    : `${state.integrated ? '登录夜阑账号' : '使用本地体验账号'} <span>→</span>`;
}
async function refreshAccount() {
  const previousId = state.me?.id;
  try {
    state.me = await api('/api/private/me');
    const data = await api('/api/private/library');
    state.library = data.characters;
    state.installations = data.installations;
    state.assets = data.assets || [];
    state.bindings = data.bindings || [];
    state.activeTheme = data.activeTheme;
  } catch (error) {
    if (error.status !== 401) toast(error.message);
    state.me = null;
    state.library = [];
    state.installations = [];
    state.assets = [];
    state.bindings = [];
    state.activeTheme = null;
  }
  if (previousId && previousId !== state.me?.id) {
    for (const id of ['workspace-dialog', 'publisher-dialog', 'library-dialog', 'phone-dialog'])
      if ($(`#${id}`).open) $(`#${id}`).close();
    $('#workspace-content').replaceChildren();
    $('#library-content').replaceChildren();
    state.liked.clear();
    $('#phone-frame').src = 'about:blank';
    window.communityAccountChanged?.();
  }
  renderAccount();
  renderResources();
}
function chooseAccount() {
  $('#account-dialog').showModal();
}
function requireLogin() {
  if (state.me) return true;
  chooseAccount();
  return false;
}
async function login(key, button) {
  button.disabled = true;
  try {
    await api('/api/demo-login', { method: 'POST', body: JSON.stringify({ account: key }) });
    await refreshAccount();
    $('#account-dialog').close();
    toast(`欢迎回来，${state.me.name}。`);
    if (state.selected) renderDetail();
    await window.communityAfterLogin?.();
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
}
function setFilter(filter) {
  state.filter = filter;
  for (const tab of document.querySelectorAll('[data-filter]')) {
    const active = tab.dataset.filter === filter;
    tab.classList.toggle('selected', active);
    tab.setAttribute('aria-selected', String(active));
  }
  for (const item of document.querySelectorAll('[data-nav]'))
    item.classList.toggle('active', item.dataset.nav === filter);
  renderResources();
}
async function openResource(id) {
  state.selected = state.resources.find((r) => r.id === id);
  if (!state.selected) {
    toast('这份资源已下架或正在重新审核，请稍后再看。');
    return;
  }
  history.replaceState(null, '', `#resource/${id}`);
  renderDetail();
  if (!$('#detail-dialog').open) $('#detail-dialog').showModal();
}
function renderDetail() {
  const r = displayResource(state.selected);
  $('#detail-content').innerHTML =
    `<div class="detail-inner"><div class="detail-heading"><div><span class="tag">${r.installable ? '已适配夜阑' : '概念预览'}</span><h2>${r.title}</h2></div><button id="install-button" class="primary-button" ${!r.installable ? 'disabled' : ''}>${installed(r) ? '✓ 已加入 · 查看资源库' : r.installable ? '＋ 一键加入我的角色库' : '暂未开放应用'}</button></div><div class="card-tags">${r.tags.map((t) => `<span class="tag">${t}</span>`).join('')}</div><section class="resource-preview" aria-label="资源预览"><div class="rp-section-head"><h3>${{ character: '认识这个角色', worldbook: '翻开这本世界书', theme: '看看主题效果' }[r.type]}</h3><span>无需安装即可查看</span></div><div id="resource-preview" aria-live="polite"></div></section><details class="detail-description-fold"><summary>资源说明与使用方法</summary><p class="detail-description">${r.description}</p></details><div class="detail-meta"><span>作者：${r.author}</span><span>版本：${r.version}</span><span>来源：${r.ownerId === 'official-editor' ? '官方原创演示' : '社区用户分享'}</span><span>${r.installable ? '应用结果：账户私有角色' : '当前仅支持预览'}</span></div><div class="detail-discussion"><h3>关于这份资源，聊一聊</h3><div id="comments"><p class="muted">正在读取 NodeBB 讨论…</p></div><form class="reply-form" id="reply-form"><input name="content" placeholder="留下一点想法，或问一个问题…" required minlength="2" maxlength="3000" aria-label="回复内容"><button class="primary-button" type="submit">发布回复</button></form></div></div>`;
  loadResourcePreview(state.selected, $('#resource-preview'));
  $('#install-button').onclick = () => (installed(r) ? openLibrary() : installResource(r));
  if (r.installable) {
    $('#install-button').textContent = installed(r)
      ? '✓ 已加入 · 查看资源库'
      : {
          character: '＋ 加入我的角色库',
          worldbook: '＋ 安装并绑定角色',
          theme: '＋ 安装并启用主题',
        }[r.type];
    if (r.type === 'worldbook' && !installed(r))
      $('#install-button').insertAdjacentHTML(
        'beforebegin',
        `<label class="asset-target">绑定到我的角色<select id="worldbook-target" aria-label="绑定到我的角色"><option value="">请选择角色</option>${state.library.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('')}</select></label>`,
      );
    $('.detail-meta span:last-child').textContent = {
      character: '应用结果：账户私有角色',
      worldbook: '应用结果：私有世界书，绑定至小手机角色',
      theme: '应用结果：当前账户小手机主题，可恢复',
    }[r.type];
  }
  $('#reply-form').onsubmit = async (event) => {
    event.preventDefault();
    if (!requireLogin()) return;
    const form = event.currentTarget;
    const button = form.querySelector('button');
    const input = form.elements.content;
    button.disabled = true;
    try {
      const result = await api(`/api/private/reply/${r.id}`, {
        method: 'POST',
        body: JSON.stringify({ content: input.value }),
      });
      input.value = '';
      toast(result.queued ? '回复已提交，等待版主审核。' : '回复已发布到论坛。');
      await loadDiscussion(r.id);
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  };
  loadDiscussion(r.id);
}
async function loadResourcePreview(resource, container) {
  if (resource.type !== 'character') {
    container.innerHTML = window.CommunityPreviews.detail(resource);
    window.CommunityPreviews.mount(container);
    return;
  }
  container.innerHTML = '<p class="rp-empty" role="status">正在翻开角色设定…</p>';
  try {
    const preview = await api(`/api/resources/${encodeURIComponent(resource.id)}/preview`);
    // A closed/replaced dialog must never receive another resource's late response.
    if (!container.isConnected || state.selected?.id !== resource.id) return;
    if (preview.version !== resource.version) throw new Error('资源已更新，请关闭后重新打开预览。');
    container.innerHTML = window.CommunityPreviews.detail(resource, preview.character);
  } catch (error) {
    if (!container.isConnected || state.selected?.id !== resource.id) return;
    container.innerHTML = `<p class="rp-empty">${escapeHtml(error.message)}</p><button class="rp-retry" type="button">重新加载预览</button>`;
    container.querySelector('button').onclick = () => loadResourcePreview(resource, container);
  }
}
function plainText(html) {
  return new DOMParser().parseFromString(html || '', 'text/html').body.textContent || '';
}
async function loadDiscussion(id, page = 1) {
  try {
    const data = await api(`/api/resources/${id}/discussion?page=${page}`);
    if (state.me) {
      const status = await api(`/api/private/vote-status/${data.pid}`);
      const key = `${state.me.id}:${data.pid}`;
      if (status.upvoted) state.liked.add(key);
      else state.liked.delete(key);
    }
    if (state.selected?.id !== id || !$('#comments')) return;
    const posts = data.posts.slice(1);
    const main = data.posts[0];
    $('#comments').innerHTML = posts.length
      ? posts
          .map(
            (post) =>
              `<div class="comment"><div class="comment-head"><strong>${escapeHtml(post.name)}</strong><time>${new Date(post.timestamp).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></div><p>${escapeHtml(plainText(post.html))}</p></div>`,
          )
          .join('')
      : '<p class="muted">讨论已经开场，等你留下第一条想法。</p>';
    const tools = document.createElement('div');
    tools.className = 'discussion-tools';
    tools.innerHTML = `<button class="vote-button" id="vote-button">${state.liked.has(`${state.me?.id}:${data.pid}`) ? '♥' : '♡'} 赞同这份分享 · ${main?.votes || 0}</button><button class="discussion-link" id="discussion-forum">在论坛中查看 ↗</button>`;
    $('#comments').append(tools);
    $('#discussion-forum').onclick = () => openForum(`/topic/${data.tid}`);
    if (page > 1 || data.hasMore) {
      const paging = document.createElement('div');
      paging.className = 'discussion-tools';
      paging.innerHTML = `<button id="previous-comments" ${page <= 1 ? 'disabled' : ''}>上一页</button><span>第 ${page} 页</span><button id="next-comments" ${!data.hasMore ? 'disabled' : ''}>下一页</button>`;
      $('#comments').append(paging);
      $('#previous-comments').onclick = () => loadDiscussion(id, page - 1);
      $('#next-comments').onclick = () => loadDiscussion(id, page + 1);
    }
    $('#vote-button').onclick = async (event) => {
      if (!requireLogin()) return;
      const key = `${state.me.id}:${data.pid}`;
      const enabled = !state.liked.has(key);
      event.currentTarget.disabled = true;
      try {
        await api(`/api/private/vote/${data.pid}`, {
          method: 'POST',
          body: JSON.stringify({ enabled }),
        });
        if (enabled) state.liked.add(key);
        else state.liked.delete(key);
        await loadDiscussion(id);
      } catch (error) {
        toast(error.message);
        if ($('#vote-button')) $('#vote-button').disabled = false;
      }
    };
  } catch (error) {
    if (state.selected?.id === id && $('#comments'))
      $('#comments').innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`;
  }
}
async function installResource(resource) {
  if (!requireLogin()) return;
  const button = $('#install-button');
  button.disabled = true;
  button.textContent = '正在加入账户…';
  try {
    const characterId = resource.type === 'worldbook' ? $('#worldbook-target')?.value : undefined;
    if (resource.type === 'worldbook' && !characterId)
      throw new Error('请先选择自己的角色；还没有角色时先安装一张角色卡');
    const result = await api(`/api/private/install/${resource.id}`, {
      method: 'POST',
      body: JSON.stringify(characterId ? { characterId } : {}),
    });
    await refreshAccount();
    renderDetail();
    toast(
      result.alreadyInstalled
        ? '资源已在你的私有资源库中。'
        : `${result.name}已保存。${resource.type === 'theme' ? '进入小手机查看主题。' : resource.type === 'worldbook' ? '世界书已绑定所选角色。' : '角色仅自己可见。'}`,
    );
  } catch (error) {
    toast(error.message);
    button.disabled = false;
    button.textContent = '重新应用';
  }
}
async function openLibrary() {
  if (window.openAssetLibrary) return window.openAssetLibrary();
  if (!requireLogin()) return;
  await refreshAccount();
  $('#library-caption').textContent = `${state.me.name}的私有资源 · 已通过夜阑实际角色创建逻辑保存`;
  $('#library-content').innerHTML = state.library.length
    ? state.library
        .map(
          (role) =>
            `<div class="library-row"><span class="avatar">${escapeHtml(role.name.slice(0, 1))}</span><div><strong>${escapeHtml(role.name)}</strong><p>${escapeHtml(role.customPayload?.worldbook?.background || '')}</p><p>角色 ID：${escapeHtml(role.id)}</p></div><span class="tag">仅自己可见</span></div>`,
        )
        .join('')
    : '<div class="empty-state"><span class="empty-icon">✳</span>你的故事，还留着空白。<br>选一份喜欢的角色卡，带 TA 回来吧。</div>';
  if (!$('#library-dialog').open) $('#library-dialog').showModal();
}
async function openForum(path) {
  if (!requireLogin()) {
    window.communityPendingForum = typeof path === 'string' ? path : '/category/5';
    return;
  }
  try {
    const { url } = await api('/api/private/forum-session', {
      method: 'POST',
      body: JSON.stringify({ path: typeof path === 'string' ? path : '/category/5' }),
    });
    location.href = url;
  } catch (error) {
    toast(error.message);
  }
}
for (const button of document.querySelectorAll('[data-close]'))
  button.onclick = () => button.closest('dialog').close();
for (const dialog of document.querySelectorAll('dialog'))
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      )
        dialog.close();
    }
  });
$('#detail-dialog').addEventListener('close', () => {
  state.selected = null;
  history.replaceState(null, '', '/');
});
for (const button of document.querySelectorAll('[data-account]'))
  button.onclick = () => login(button.dataset.account, button);
for (const button of document.querySelectorAll('[data-filter]'))
  button.onclick = () => setFilter(button.dataset.filter);
for (const button of document.querySelectorAll('[data-nav]'))
  button.onclick = () => {
    setFilter(button.dataset.nav);
    $('#resources-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
$('#account-button').onclick = chooseAccount;
$('#welcome-login').onclick = () => (state.me ? openLibrary() : chooseAccount());
$('#library-nav').onclick = openLibrary;
for (const id of ['forum-nav', 'all-discussions', 'share-button']) $(`#${id}`).onclick = openForum;
$('#search').oninput = (event) => {
  state.search = event.target.value.trim();
  renderResources();
};
$('#explore-button').onclick = () => $('#resources-section').scrollIntoView({ behavior: 'smooth' });
$('#logout-button').onclick = async () => {
  await api('/api/logout', { method: 'POST', body: '{}' });
  await refreshAccount();
  $('#account-dialog').close();
  if (state.selected) renderDetail();
  toast('已退出本地账号。');
};
async function boot() {
  try {
    const mode = await api('/api/account-mode');
    state.integrated = mode.integrated;
    if (mode.integrated) {
      $('.demo-details').hidden = true;
      $('#auth-toggle').hidden = true;
      $('#account-dialog .dialog-foot').textContent = '使用夜阑正式账号；资源副本按账号独立保存。';
      $('#account-dialog h2').textContent = '登录夜阑账号';
      const link = document.createElement('a');
      link.href = '/account/start';
      link.className = 'primary-button';
      link.textContent = '使用主站登录状态进入';
      $('#auth-form').before(link);
      $('#auth-form').insertAdjacentHTML('beforebegin', '<p class="muted">也可直接输入夜阑账号的邮箱和密码。</p>');
      $('#phone-dialog .muted').textContent = '账号与夜阑主站一致，使用现有模型进行对话；世界书与主题作用于小手机。';
      $('footer span').textContent = '原创社区资源 · 账号独立副本';
      const foot = document.querySelector('.sidebar-bottom');
      if (foot) foot.textContent = '社区内部测试 · 夜阑账号已接通';
    }
    await refreshResources();
    await refreshAccount();
    const id = location.hash.match(/^#resource\/([a-z0-9-]+)$/)?.[1];
    if (id) openResource(id);
    await window.communityReady?.();
  } catch (error) {
    toast(error.message);
  }
  try {
    const health = await api('/api/health');
    state.forum = health.forum;
    $('#backend-status').textContent = health.forum
      ? `● NodeBB ${health.version} 已连接`
      : '○ NodeBB 启动中 · 资源库可先体验';
    if (!health.forum) setTimeout(refreshHealth, 3000);
  } catch {
    $('#backend-status').textContent = '○ 社区连接暂不可用';
  }
}
let healthRetries = 0;
async function refreshHealth() {
  try {
    const health = await api('/api/health');
    state.forum = health.forum;
    if (health.forum) {
      $('#backend-status').textContent = `● NodeBB ${health.version} 已连接`;
      return;
    }
  } catch {
    /* Keep the existing visible offline state. */
  }
  if (++healthRetries < 20) setTimeout(refreshHealth, 3000);
}
boot();
async function refreshResources() {
  const data = await api('/api/resources');
  state.resources = data.resources;
  try {
    state.topics = (await api('/api/discussions')).topics;
  } catch {
    state.topics = [];
  }
  if (state.selected) {
    const updated = state.resources.find((r) => r.id === state.selected.id);
    if (updated) state.selected = updated;
    else {
      $('#detail-dialog').close();
      toast('这份资源已下架或正在重新审核。');
    }
  }
  renderResources();
}
window.addEventListener('focus', () =>
  Promise.all([refreshAccount(), refreshResources()]).catch(() => {}),
);
