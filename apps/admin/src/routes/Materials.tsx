import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Pagination } from '../components/Pagination';

interface Material { id: string; userId: string; characterId: string | null; prompt: string; model: string; createdAt: string; bytes: number; thumbnailDataUrl: string }
interface Page { items: Material[]; total: number; page: number; pageSize: number }
export function Materials() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page | null>(null);
  const [filter, setFilter] = useState('');
  const [userId, setUserId] = useState('');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true; setError(''); setData(null);
    api.get<Page>(`/api/admin/materials?page=${page}&userId=${encodeURIComponent(userId)}`)
      .then(result => { if (active) setData(result); })
      .catch(() => { if (active) setError('素材加载失败，请检查后台连接与权限'); });
    return () => { active = false; };
  }, [page, userId, revision]);
  return <section>
    <h1>素材库</h1><p>用户生成图片的压缩预览，单张不超过 200 KB。原图保留在用户端。</p>
    <form onSubmit={event => { event.preventDefault(); setPage(1); setUserId(filter.trim()); }} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
      <input aria-label="按用户 ID 筛选" placeholder="用户 ID，留空显示全部" value={filter} onChange={event => setFilter(event.target.value)} />
      <button className="btn" type="submit">筛选</button><button className="btn" type="button" onClick={() => setRevision(value => value + 1)}>刷新</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {!data && !error && <p>加载中…</p>}
    {data && <>
      <p>共 {data.total} 张</p>
      {data.items.length === 0 && <p>暂无生成图片</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 16 }}>
        {data.items.map(item => <article key={item.id} style={{ border: '1px solid var(--border, #ddd)', borderRadius: 12, padding: 12, overflow: 'hidden' }}>
          <img src={item.thumbnailDataUrl} alt={item.prompt} loading="lazy" style={{ width: '100%', aspectRatio: '1', objectFit: 'contain', borderRadius: 8 }} />
          <p style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{item.prompt}</p>
          <small style={{ overflowWrap: 'anywhere' }}>用户：{item.userId}<br />角色：{item.characterId || '无'}<br />{item.model} · {Math.round(item.bytes / 1024)} KB<br />{new Date(item.createdAt).toLocaleString()}</small>
        </article>)}
      </div>
      <Pagination page={page} total={data.total} pageSize={data.pageSize} onChange={next => { setData(null); setPage(next); }} />
    </>}
  </section>;
}
