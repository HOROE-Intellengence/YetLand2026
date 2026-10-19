'use strict';
(() => {
  function update() {
    const link = document.getElementById('yelan-publish');
    const topic = location.pathname.match(/^\/topic\/(\d+)/)?.[1];
    if (link) {
      const communityOrigin = new URL(link.href).origin;
      link.href = `${communityOrigin}/?publish=1${topic ? `&topic=${topic}` : ''}`;
      link.textContent = topic ? '将帖子发布为资源' : '发布资源';
    }
  }
  require(['hooks'], (hooks) => hooks.on('action:ajaxify.end', update));
  update();
  let checking = false;
  async function check() {
    if (checking || document.hidden) return;
    checking = true;
    try {
      const r = await fetch('/api/yelan-local/session-status', { cache: 'no-store' });
      if (!r.ok) return;
      const s = await r.json();
      if (Number(s.uid) !== Number(app.user.uid)) location.reload();
    } catch {
    } finally {
      checking = false;
    }
  }
  window.addEventListener('focus', check);
  document.addEventListener('visibilitychange', check);
  setInterval(check, 10000);
})();
