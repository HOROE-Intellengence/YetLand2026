'use client';
import { useEffect, useState, type ComponentType } from 'react';
import { isYelanManaged, setYelanToken, scopePhoneStorage, yelanRequest } from '@/lib/yelan-managed-client';
import { yelanParentOrigins } from '@/lib/yelan-parent-origin';

export function YelanManagedEntry() {
  const [App, setApp] = useState<ComponentType | null>(null);
  const [error, setError] = useState('请从夜阑功能选择页进入小手机');
  useEffect(() => {
    if (!isYelanManaged) return;
    const fitPhone = () => {
      // The original desktop shell is 844px tall; an embedded window can be
      // shorter. Scale the complete shell so its bottom controls remain reachable.
      const scale = Math.min(1, Math.max(0.25, (window.innerHeight - 32) / 866));
      document.documentElement.style.setProperty('--yelan-phone-scale', String(scale));
    };
    fitPhone(); window.addEventListener('resize', fitPhone);
    return () => window.removeEventListener('resize', fitPhone);
  }, []);
  useEffect(() => {
    let disposed = false;
    let started = false;
    const parentOrigins = yelanParentOrigins(process.env.NEXT_PUBLIC_YELAN_WEB_ORIGIN || 'http://localhost:5173');
    async function receive(event: MessageEvent) {
      if (event.source !== window.parent || !parentOrigins.includes(event.origin) || event.data?.type !== 'yelan:phone-session') return;
      if (started || typeof event.data.token !== 'string') return;
      started = true;
      try {
        setError('正在载入夜阑小手机…');
        setYelanToken(event.data.token);
        const user = await yelanRequest<{ id: string }>('/auth/me');
        if (!user.id) throw new Error('登录状态无效');
        if (disposed) return;
        scopePhoneStorage(user.id);
        const app = await import('./main-app');
        if (!disposed) setApp(() => app.MainApp);
      } catch (e) { if (!disposed) setError(e instanceof Error ? e.message : '载入失败'); }
    }
    if (!isYelanManaged) {
      void import('./main-app').then(app => { if (!disposed) setApp(() => app.MainApp); });
    } else {
      window.addEventListener('message', receive);
      if (window.parent !== window) for (const origin of parentOrigins) window.parent.postMessage({ type: 'yelan:phone-ready' }, origin);
    }
    return () => { disposed = true; window.removeEventListener('message', receive); };
  }, []);
  return App ? <App /> : <main style={{ padding: 32, fontFamily: 'sans-serif' }}>{error}</main>;
}
