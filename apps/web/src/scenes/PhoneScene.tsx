import { useEffect, useRef, useState } from 'react';
import { api, getToken } from '../api/client';
import { useSessionStore } from '../stores/sessionStore';

export function PhoneScene() {
  const goOpening = useSessionStore(state => state.goOpening);
  const goLogin = useSessionStore(state => state.goPhoneLogin);
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const phoneUrl = import.meta.env.VITE_PHONE_URL || (import.meta.env.DEV ? 'http://localhost:3001' : '');
  useEffect(() => {
    let cancelled = false;
    if (!getToken()) return;
    api('/api/auth/me').then(() => { if (!cancelled) setReady(true); })
      .catch(() => { if (!cancelled) setError('登录已失效，请重新登录'); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!ready || !phoneUrl) return;
    const origin = new URL(phoneUrl, location.href).origin;
    const receive = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== frame.current?.contentWindow || event.data?.type !== 'yelan:phone-ready') return;
      event.source?.postMessage({ type: 'yelan:phone-session', token: getToken() }, { targetOrigin: origin });
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [ready, phoneUrl]);
  return <section style={{ position: 'fixed', inset: 0, zIndex: 50, background: '#f5f4ef', display: 'flex', flexDirection: 'column' }}>
    <header style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '12px 20px', color: '#222' }}>
      <button onClick={goOpening}>返回功能选择</button><strong>夜阑 · 小手机</strong>
    </header>
    {!ready ? <div style={{ padding: 24, color: '#222' }}>
      <p>{error || (getToken() ? '正在验证登录…' : '登录夜阑后进入小手机')}</p>
      {(!getToken() || error) && <button onClick={goLogin}>登录夜阑</button>}
    </div> : !phoneUrl ? <p style={{ padding: 24 }}>小手机服务尚未配置，请联系管理员。</p> :
      <iframe ref={frame} title="夜阑小手机" src={phoneUrl} allow="microphone; autoplay" style={{ border: 0, flex: 1, width: '100%' }} />}
  </section>;
}
