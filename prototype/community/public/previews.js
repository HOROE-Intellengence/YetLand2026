/* Read-only resource previews. Only text, whitelisted colors and inline bitmap wallpaper. */
(() => {
  const esc = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  const clip = (value, max) => {
    const text = String(value || '').trim();
    return esc(text.length > max ? `${text.slice(0, max)}…` : text);
  };
  const colors = {
    '--c-header-bg': '#ffffff',
    '--c-page-body-bg': '#f1f2f6',
    '--c-card': '#ffffffb3',
    '--c-card-border': '#e0e0e0',
    '--c-panel': '#ffffff',
    '--c-panel-border': '#d9dadb',
    '--c-text-title': '#2c3440',
    '--c-text': '#797e85',
    '--c-icon-active': '#4a4a4a',
    '--c-icon': '#a0a3a8',
    '--c-input': '#f2f3f5',
    '--c-input-border': '#e0e2e500',
    '--c-bubble-self': '#95ec69',
    '--c-bubble-other': '#ffffff',
  };
  const palette = [
    ['--c-page-body-bg', '背景'],
    ['--c-header-bg', '顶栏'],
    ['--c-text-title', '标题'],
    ['--c-text', '正文'],
    ['--c-bubble-self', '我的气泡'],
    ['--c-bubble-other', '对方气泡'],
  ];
  function themeColors(theme) {
    return Object.fromEntries(
      Object.entries(colors).map(([key, fallback]) => [
        key,
        /^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(theme?.cssOverrides?.[key] || '')
          ? theme.cssOverrides[key]
          : fallback,
      ]),
    );
  }
  function themeStyle(theme) {
    const vars = Object.entries(themeColors(theme)).map(([key, value]) => `${key}:${value}`);
    vars.push(
      `font-family:${
        {
          system: 'system-ui,sans-serif',
          serif: '"Noto Serif SC","Songti SC",serif',
          monospace: '"SFMono-Regular",Consolas,monospace',
        }[theme?.fontFamily] || 'system-ui,sans-serif'
      }`,
    );
    return esc(vars.join(';'));
  }
  function wallpaper(theme) {
    const w = theme?.wallpaper;
    if (
      !w ||
      !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(w.dataUrl || '') ||
      w.dataUrl.length > 80000
    )
      return '';
    const number = (value, min, max, fallback) =>
      typeof value === 'number' && Number.isFinite(value)
        ? Math.max(min, Math.min(max, value))
        : fallback;
    const style =
      `opacity:${number(w.opacity, 0, 1, 0.9)};filter:blur(${number(w.blur, 0, 24, 0)}px);` +
      `background-image:url('${w.dataUrl}');background-size:${number(w.scale, 10, 200, 100)}% auto;` +
      `background-position:${number(w.x, 0, 100, 50)}% ${number(w.y, 0, 100, 50)}%`;
    return `<span class="rp-wallpaper" style="${esc(style)}" aria-hidden="true"></span>`;
  }
  function phone(theme, scene = 'desktop') {
    const chat = scene === 'chat';
    return `<div class="rp-phone" style="${themeStyle(theme)}" aria-label="${chat ? '聊天' : '桌面'}配色示意">
      ${wallpaper(theme)}<div class="rp-phone-content">
      <div class="rp-status"><span>9:41</span><span aria-hidden="true">▮▮▮ ▰</span></div>
      ${
        chat
          ? `<div class="rp-chat-header">‹ <strong>夜阑</strong><span>···</span></div>
        <div class="rp-chat-messages"><span class="rp-chat-time">今天 09:41</span>
        <div class="rp-bubble rp-other">今天，想聊点什么？</div>
        <div class="rp-bubble rp-self">就从一件小事开始吧。</div>
        <div class="rp-bubble rp-other">好，我在听。</div></div>
        <div class="rp-chat-input"><span>写下你的消息…</span><b>↑</b></div>`
          : `<div class="rp-clock">09:41<small>周日 · 留一点时间给自己</small></div>
        <div class="rp-note"><small>今日便签</small><strong>把日常，过成喜欢的样子。</strong></div>
        <div class="rp-apps">${[
          ['◌', '聊天'],
          ['▤', '手记'],
          ['✳', '主题'],
          ['▦', '相册'],
        ]
          .map(
            ([glyph, label]) =>
              `<span><i aria-hidden="true">${glyph}</i><small>${label}</small></span>`,
          )
          .join('')}</div>
        <div class="rp-dock"><span>◌</span><span>⌕</span><span>⚙</span></div>`
      }
      <span class="rp-home" aria-hidden="true"></span></div></div>`;
  }
  function entryName(entry, index) {
    return entry.constant ? `常驻设定 ${index + 1}` : entry.key || '未设置触发词';
  }
  function card(resource) {
    const r = resource;
    if (r.type === 'theme' && r.theme) {
      const swatches = palette
        .slice(0, 4)
        .map(([key]) => `<i style="background:${themeColors(r.theme)[key]}"></i>`)
        .join('');
      return `<div class="rp-cover rp-cover-theme">${phone(r.theme, 'chat')}<div class="rp-theme-caption">
        <span class="rp-kicker">手机主题</span><strong>${esc(r.theme.name)}</strong><div class="rp-swatches" aria-hidden="true">${swatches}</div>
        <small>${r.theme.wallpaper ? '含壁纸' : '配色主题'} · 配色示意</small></div><span class="rp-peek">查看预览 ↗</span></div>`;
    }
    if (r.type === 'worldbook' && r.worldbook?.entries?.length) {
      const entries = r.worldbook.entries;
      const constant = entries.filter((e) => e.constant).length;
      return `<div class="rp-cover rp-cover-book"><div class="rp-book-spine" aria-hidden="true">WORLD BOOK</div>
        <div class="rp-book-page"><span class="rp-kicker">世界书 · ${entries.length} 条设定</span>
        <strong>${clip(r.title, 30)}</strong><div class="rp-book-lines">${entries
          .slice(0, 3)
          .map(
            (e, i) =>
              `<span><i aria-hidden="true">${e.constant ? '●' : '◇'}</i>${clip(entryName(e, i), 24)}</span>`,
          )
          .join('')}</div>
        <small>${constant} 条常驻 · ${entries.length - constant} 条关键词</small></div><span class="rp-peek">展开条目 ↗</span></div>`;
    }
    const p = r.preview;
    const name = p?.name || r.title;
    return `<div class="rp-cover rp-cover-character"><span class="rp-kicker">角色卡 · 人设预览</span>
      <div class="rp-character-line"><span class="rp-monogram" aria-hidden="true">${esc([...name].slice(-1).join(''))}</span>
      <div><strong>${esc(name)}</strong><small>${clip(p?.location || r.subtitle, 40)}</small></div></div>
      <p class="rp-character-intro">${clip(p?.background || r.subtitle, 86)}</p>
      <div class="rp-opening-mini">${p?.opening ? `“${clip(p.opening, 54)}”` : '查看角色背景与相处方式'}</div>
      <span class="rp-peek">查看人设 ↗</span></div>`;
  }
  function block(label, text) {
    return text ? `<div class="rp-text-block"><h4>${label}</h4><p>${esc(text)}</p></div>` : '';
  }
  function character(p) {
    if (!p) return '<p class="rp-empty">这份角色卡暂无可预览的人设。</p>';
    return `<div class="rp-character-detail"><div class="rp-character-profile"><span class="rp-monogram" aria-hidden="true">${esc([...p.name].slice(-1).join(''))}</span>
      <div><h3>${esc(p.name)}</h3><p>${esc(p.location || '角色设定')}</p></div></div>
      ${p.opening ? `<div class="rp-opening"><span class="rp-kicker">初始场景 / 开场动作</span><p>${esc(p.opening)}</p><small>来自作者设定</small></div>` : ''}
      ${block('角色背景', p.background)}<div class="rp-fact-grid">${block('你们的关系', p.relationshipByUser)}${block('TA 眼中的你', p.relationshipByChar)}</div>
      ${block('相处方式', p.principles)}${block('说话风格', p.style)}
      ${p.boundaries ? `<details class="rp-boundaries"><summary>角色边界</summary><p>${esc(p.boundaries)}</p></details>` : ''}
      <p class="rp-footnote">以上为角色卡原有设定，实际回复随对话情境变化。</p></div>`;
  }
  function worldbook(r) {
    const entries = r.worldbook?.entries || [];
    if (!entries.length) return '<p class="rp-empty">这份世界书暂无可预览的条目。</p>';
    const constant = entries.filter((e) => e.constant).length;
    return `<div class="rp-book-stats"><span><strong>${entries.length}</strong>条设定</span><span><strong>${constant}</strong>条常驻</span><span><strong>${entries.length - constant}</strong>条关键词</span></div>
      <p class="rp-footnote">展开查看完整内容；常驻设定随上下文载入，其余条目按关键词或正则匹配。</p>
      <div class="rp-entries">${entries
        .map(
          (e, i) => `<details class="rp-entry" ${i === 0 ? 'open' : ''}>
        <summary><span class="rp-entry-number">${String(i + 1).padStart(2, '0')}</span><strong>${esc(entryName(e, i))}</strong><span class="rp-entry-kind">${e.constant ? '常驻' : e.useRegex ? '正则' : '关键词'}</span></summary>
        <div class="rp-entry-body">${!e.constant ? `<div class="rp-trigger">${e.useRegex ? '匹配表达式' : '触发词'}：${esc(e.key || '未设置')}</div>` : ''}
        <p>${esc(e.content)}</p><small>${e.position === 'before_char' ? '放在角色设定之前' : '放在角色设定之后'}</small></div></details>`,
        )
        .join('')}</div>`;
  }
  function theme(r) {
    if (!r.theme) return '<p class="rp-empty">这份主题暂无可预览的配色。</p>';
    const t = r.theme;
    const resolved = themeColors(t);
    return `<div class="rp-theme-layout"><div class="rp-theme-stage"><div class="rp-scenes" role="group" aria-label="主题预览场景">
      <button type="button" data-preview-scene="desktop" aria-pressed="true">桌面</button><button type="button" data-preview-scene="chat" aria-pressed="false">聊天</button></div>
      <div data-preview-panel="desktop">${phone(t)}</div><div data-preview-panel="chat" hidden>${phone(t, 'chat')}</div></div>
      <div class="rp-theme-info"><span class="rp-kicker">配色与字体</span><h3>${esc(t.name)}</h3>
      <p>${{ system: '系统字体', serif: '衬线字体', monospace: '等宽字体' }[t.fontFamily] || '系统字体'} · ${t.wallpaper ? '含壁纸' : '无壁纸'}</p>
      <div class="rp-palette">${palette.map(([key, label]) => `<div><i style="background:${resolved[key]}"></i><span>${label}<small>${t.cssOverrides?.[key] === resolved[key] ? esc(resolved[key]) : '沿用原配色'}</small></span></div>`).join('')}</div>
      <p class="rp-footnote">使用主题实际色值的示意画面；未指定颜色以默认值展示，安装后会沿用你原有的设置。</p>
      <p class="rp-footnote">切换预览不会更改当前主题。</p></div></div>`;
  }
  function detail(r, p) {
    return r.type === 'character' ? character(p) : r.type === 'worldbook' ? worldbook(r) : theme(r);
  }
  function mount(container) {
    container.querySelectorAll('[data-preview-scene]').forEach((button) => {
      button.onclick = () => {
        container
          .querySelectorAll('[data-preview-scene]')
          .forEach((tab) => tab.setAttribute('aria-pressed', String(tab === button)));
        container
          .querySelectorAll('[data-preview-panel]')
          .forEach(
            (panel) => (panel.hidden = panel.dataset.previewPanel !== button.dataset.previewScene),
          );
      };
    });
  }
  window.CommunityPreviews = { card, detail, mount };
})();
