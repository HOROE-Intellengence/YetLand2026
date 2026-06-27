// 记事 — 本地记忆查看（preferences + events），含"忘了一切"二次确认
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getToken } from '../../../api/client';
import { deleteAllMemories, listMemories } from '../../../api/memories';
import { memoryDb, type EventRow, type PreferenceRow } from '../../../memory/db';
import s from './panel.module.css';

interface MemoryItem {
  id: string;
  type: '偏好' | '事件';
  text: string;
  meta: string;
}

interface ProfileFactItem {
  id: string;
  text: string;
  meta: string;
}

function localPreferenceToItem(row: PreferenceRow): MemoryItem {
  return {
    id: `local-pref-${row.id ?? row.serverId ?? row.text}`,
    type: '偏好',
    text: row.text,
    meta: `${row.mode} · 权重 ${row.weight}`,
  };
}

function localEventToItem(row: EventRow): MemoryItem {
  return {
    id: `local-event-${row.id ?? row.serverId ?? row.text}`,
    type: '事件',
    text: row.text,
    meta: `${row.mode} · ${row.date}${row.emotion ? ` · ${row.emotion}` : ''}`,
  };
}

export function MemoryPanel() {
  const token = getToken();
  const queryClient = useQueryClient();
  const [localItems, setLocalItems] = useState<MemoryItem[]>([]);
  const [confirmingForget, setConfirmingForget] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const memoriesQuery = useQuery({
    queryKey: ['me', 'memories'],
    queryFn: () => listMemories(),
    enabled: Boolean(token),
    retry: 1,
  });

  useEffect(() => {
    let cancelled = false;
    async function loadLocal() {
      const [preferences, events] = await Promise.all([
        memoryDb.preferences.toArray(),
        memoryDb.events.toArray(),
      ]);
      if (cancelled) return;
      setLocalItems([
        ...preferences.filter((row) => !row.tombstone).map(localPreferenceToItem),
        ...events.filter((row) => !row.tombstone).map(localEventToItem),
      ].slice(0, 30));
    }
    void loadLocal();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!confirmingForget) return;
    const timer = window.setTimeout(() => setConfirmingForget(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirmingForget]);

  const serverItems = useMemo<MemoryItem[]>(() => {
    if (!memoriesQuery.data) return [];
    return [
      ...memoriesQuery.data.preferences
        .filter((row) => !row.tombstone)
        .map((row) => ({
          id: `server-pref-${row.id}`,
          type: '偏好' as const,
          text: row.text,
          meta: `${row.mode} · 权重 ${row.weight}`,
        })),
      ...memoriesQuery.data.events
        .filter((row) => !row.tombstone)
        .map((row) => ({
          id: `server-event-${row.id}`,
          type: '事件' as const,
          text: row.text,
          meta: `${row.mode} · ${row.date}${row.emotion ? ` · ${row.emotion}` : ''}`,
        })),
    ].slice(0, 30);
  }, [memoriesQuery.data]);

  const profileSnapshot = token ? memoriesQuery.data?.profile.snapshot ?? null : null;
  const profileFacts = useMemo<ProfileFactItem[]>(() => {
    if (!memoriesQuery.data?.profile.facts) return [];
    return memoriesQuery.data.profile.facts.map((fact) => ({
      id: `profile-fact-${fact.id}`,
      text: fact.text,
      meta: `${fact.type} · ${fact.scope} · 可信度 ${Math.round(fact.confidence * 100)}%`,
    }));
  }, [memoriesQuery.data]);

  const visibleItems = token ? serverItems : localItems;
  const hasMemory = visibleItems.length > 0 || Boolean(profileSnapshot?.markdown.trim()) || profileFacts.length > 0;

  const handleForgetAll = async () => {
    if (!confirmingForget) {
      setConfirmingForget(true);
      return;
    }
    setForgetting(true);
    try {
      if (token) await deleteAllMemories();
      await Promise.all([memoryDb.preferences.clear(), memoryDb.events.clear()]);
      setLocalItems([]);
      await queryClient.invalidateQueries({ queryKey: ['me', 'memories'] });
    } finally {
      setForgetting(false);
      setConfirmingForget(false);
    }
  };

  return (
    <div className={s.panel}>
      <h2 className={s.title}>记事</h2>
      <p className={s.dim}>你和角色之间的记忆碎片。</p>

      {!token && (
        <div className={s.placeholder}>
          <p>未登录时只显示本机缓存。</p>
        </div>
      )}

      {token && profileSnapshot?.markdown && (
        <div className={s.section}>
          <strong className={s.rowTitle}>画像</strong>
          <p className={s.quote}>{profileSnapshot.markdown}</p>
          <span className={s.rowMeta}>更新于 {new Date(profileSnapshot.updatedAt).toLocaleString()}</span>
        </div>
      )}

      {token && profileFacts.length > 0 && (
        <div className={s.section}>
          <strong className={s.rowTitle}>画像线索</strong>
          <div className={s.list}>
            {profileFacts.map((item) => (
              <div className={s.listRow} key={item.id}>
                <div>
                  <span className={s.rowMeta}>{item.meta}</span>
                  <p className={s.quote}>{item.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {token && memoriesQuery.isLoading ? (
        <div className={s.placeholder}><p>正在翻找记忆...</p></div>
      ) : token && memoriesQuery.isError ? (
        <div className={s.placeholder}><p>服务端记忆暂时取不到。</p></div>
      ) : visibleItems.length > 0 ? (
        <div className={s.list}>
          {visibleItems.map((item) => (
            <div className={s.listRow} key={item.id}>
              <div>
                <strong className={s.rowTitle}>{item.type}</strong>
                <span className={s.rowMeta}>{item.meta}</span>
                <p className={s.quote}>{item.text}</p>
              </div>
            </div>
          ))}
        </div>
      ) : !hasMemory ? (
        <div className={s.placeholder}><p>暂时没有可展示的记忆。</p></div>
      ) : null}

      <button
        className={s.dangerBtn}
        disabled={forgetting || !hasMemory}
        onClick={handleForgetAll}
        type="button"
      >
        {confirmingForget ? '确认忘记全部' : '忘了一切'}
      </button>
    </div>
  );
}
