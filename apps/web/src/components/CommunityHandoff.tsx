import { useEffect, useRef, useState } from 'react';
import { api, ApiError, getToken } from '../api/client';
import { useSessionStore } from '../stores/sessionStore';

/** Community issues a browser-bound challenge before opening this main-account login. */
export function CommunityHandoff() {
  const scene = useSessionStore(s => s.scene);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const challenge = new URLSearchParams(location.search).get('community');
  useEffect(() => {
    if (!challenge || !/^[a-f0-9]{64}$/.test(challenge) || pending.current || scene === 'login') return;
    if (!getToken()) { useSessionStore.getState().goLogin(); return; }
    pending.current = true;
    void api<{ url: string }>('/api/community-session', { method: 'POST', body: JSON.stringify({ challenge }) })
      .then(result => { location.replace(result.url); })
      .catch(err => {
        pending.current = false;
        if (err instanceof ApiError && err.status === 401) useSessionStore.getState().goLogin();
        else setError('社区登录暂不可用，请返回社区重试。');
      });
  }, [challenge, scene]);
  return error ? <div role="alert" style={{ position: 'fixed', top: 16, left: 16, zIndex: 10000, background: '#181818', color: '#fff', padding: 20 }}>{error} <a href="https://community.yetland.cn/">返回社区</a></div> : null;
}
