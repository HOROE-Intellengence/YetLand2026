export function paginationState(page: number, total: number, pageSize: number) {
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  return { pages, previous: page > 1, next: page < pages };
}
export function Pagination({ page, total, pageSize, loading = false, onChange }: {
  page: number; total: number; pageSize: number; loading?: boolean; onChange: (page: number) => void;
}) {
  const state = paginationState(page, total, pageSize);
  return <nav aria-label="列表分页" className="pagination">
    <button type="button" className="btn" disabled={loading || !state.previous} onClick={() => onChange(page - 1)}>上一页</button>
    <span role="status">{loading ? '加载中…' : `第 ${page} / ${state.pages} 页 · 共 ${total} 条`}</span>
    <button type="button" className="btn" disabled={loading || !state.next} onClick={() => onChange(page + 1)}>下一页</button>
    {!loading && !state.next && <small className="text-muted">{total === 0 ? '暂无记录' : state.pages === 1 ? '已全部显示，无需翻页' : '已到最后一页'}</small>}
  </nav>;
}
