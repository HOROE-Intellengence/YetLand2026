'use strict';
window.openAssetLibrary = async () => {
  if (!requireLogin()) return;
  await refreshAccount();
  $('#library-caption').textContent = `${state.me.name}的私有角色、世界书和主题`;
  const options = state.library
    .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`)
    .join('');
  $('#library-content').innerHTML =
    `<div class="workspace-toolbar"><button id="library-phone" class="primary-button">进入小手机查看效果</button><button id="restore-theme" class="text-button">恢复应用主题前的外观</button></div><p class="muted">绑定与主题变更在重新进入小手机后生效。解绑会保留在小手机中手动改写过的世界书条目。</p>` +
    state.library
      .map(
        (c) =>
          `<section class="work-card"><span class="tag">私有角色</span><h3>${escapeHtml(c.name)}</h3><p>${escapeHtml(c.customPayload?.worldbook?.background || '')}</p><small>${escapeHtml(c.id)}</small></section>`,
      )
      .join('') +
    state.assets
      .map(
        (a) =>
          `<section class="work-card"><span class="tag">${typeLabel(a.type)} · v${escapeHtml(a.version)}</span><h3>${escapeHtml(a.title)}</h3>${
            a.type === 'worldbook'
              ? `<p>已绑定：${
                  state.bindings
                    .filter((b) => b.assetId === a.id)
                    .map((b) =>
                      escapeHtml(
                        state.library.find((c) => c.id === b.characterId)?.name || '角色已移除',
                      ),
                    )
                    .join('、') || '尚未绑定'
                }</p><select id="target-${a.id}" aria-label="${escapeHtml(a.title)}的绑定角色">${options}</select><button class="text-button" data-bind="${a.id}">绑定所选角色</button>${state.bindings
                  .filter((b) => b.assetId === a.id)
                  .map(
                    (b) =>
                      `<button class="text-button" data-unbind="${a.id}" data-character="${escapeHtml(b.characterId)}">解绑 ${escapeHtml(state.library.find((c) => c.id === b.characterId)?.name || '角色')}</button>`,
                  )
                  .join('')}`
              : `<p>${state.activeTheme?.installationId === a.id ? '✓ 当前启用' : '已保存，尚未启用'}</p><button class="text-button" data-theme="${a.id}">启用此主题</button>`
          }<details><summary>查看私有安装内容</summary><pre>${escapeHtml(JSON.stringify(a.payload, null, 2))}</pre></details></section>`,
      )
      .join('');
  if (!state.library.length && !state.assets.length)
    $('#library-content').insertAdjacentHTML(
      'beforeend',
      '<p class="empty-state">还没有资源，先安装喜欢的角色或主题吧。</p>',
    );
  $('#library-phone').onclick = openPhone;
  $('#restore-theme').onclick = () => libraryAction('/api/private/themes/activate', { id: null });
  document
    .querySelectorAll('[data-theme]')
    .forEach(
      (b) =>
        (b.onclick = () => libraryAction('/api/private/themes/activate', { id: b.dataset.theme })),
    );
  document
    .querySelectorAll('[data-bind]')
    .forEach(
      (b) =>
        (b.onclick = () =>
          libraryAction(`/api/private/assets/${b.dataset.bind}/bind`, {
            characterId: $(`#target-${b.dataset.bind}`).value,
          })),
    );
  document
    .querySelectorAll('[data-unbind]')
    .forEach(
      (b) =>
        (b.onclick = () =>
          libraryAction(`/api/private/assets/${b.dataset.unbind}/unbind`, {
            characterId: b.dataset.character,
          })),
    );
  if (!$('#library-dialog').open) $('#library-dialog').showModal();
};
async function libraryAction(path, body) {
  try {
    await api(path, { method: 'POST', body: JSON.stringify(body) });
    await window.openAssetLibrary();
    toast('已保存，重新进入小手机生效。');
  } catch (e) {
    toast(e.message);
  }
}
let launch = null;
async function openPhone() {
  if (!requireLogin()) return;
  try {
    launch = await api('/api/private/phone-session', { method: 'POST', body: '{}' });
    const health = await fetch(`${launch.url}/api/community-prototype-health`, {
      credentials: 'include',
      signal: AbortSignal.timeout(5000),
    });
    if (!health.ok) throw new Error();
    $('#phone-frame').src = launch.url;
    $('#phone-dialog').showModal();
  } catch {
    toast('本地小手机未就绪，请运行 node prototype/community/start-phone.mjs');
  }
}
window.addEventListener('message', (e) => {
  if (
    !launch ||
    e.source !== $('#phone-frame').contentWindow ||
    e.origin !== new URL(launch.url).origin ||
    e.data?.type !== 'yelan:phone-ready'
  )
    return;
  e.source.postMessage({ type: 'yelan:phone-session', token: launch.token }, e.origin);
});
$('#phone-dialog').addEventListener('close', () => {
  $('#phone-frame').src = 'about:blank';
  launch = null;
});
$('#phone-nav').onclick = openPhone;
