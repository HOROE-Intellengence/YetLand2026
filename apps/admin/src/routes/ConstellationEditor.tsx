// 星座可视化编辑器 —— 按角色 slug 增删星点 / 连边，实时金色预览，保存到独立存储。
// 数据：GET/PUT/DELETE /api/admin/constellations/:slug；角色列表 GET /api/admin/characters。
import { useEffect, useRef, useState } from 'react';
import { Sparkles, Save, RotateCcw, Circle, Trash2, FileInput, Copy } from 'lucide-react';
import {
  AdminCharactersListResponseSchema,
  AdminConstellationResponseSchema,
  AdminConstellationPutSchema,
  ConstellationSchema,
} from '@yelan/shared';
import { api } from '../api/client';
import { useToast } from '../components/Toast';
import { formatDateTime } from '../lib/datetime';
import { parseConstellationDsl, serializeConstellationDsl } from './constellation-dsl';

interface Pt { id: string; x: number; y: number }
interface Edge { from: string; to: string }
interface CharOption { slug: string; name: string }

// 坐标域：x 0..100，y -40..100（负值浮于卡片上边界之上，与 web 渲染 viewBox 对齐）
const X_MIN = 0, X_MAX = 100, Y_MIN = -40, Y_MAX = 100;
const clampX = (v: number) => Math.min(X_MAX, Math.max(X_MIN, Math.round(v * 10) / 10));
const clampY = (v: number) => Math.min(Y_MAX, Math.max(Y_MIN, Math.round(v * 10) / 10));

const GOLD_GLOW = 'rgba(229, 204, 162, 0.55)';
const GOLD_LIGHT = '#e9d8b0';

function genId(existing: Pt[]): string {
  const used = new Set(existing.map((p) => p.id));
  for (let i = 0; i < 26; i++) {
    const ch = String.fromCharCode(65 + i);
    if (!used.has(ch)) return ch;
  }
  let n = 1;
  while (used.has(`P${n}`)) n++;
  return `P${n}`;
}

function sameEdge(a: Edge, b: Edge): boolean {
  return (a.from === b.from && a.to === b.to) || (a.from === b.to && a.to === b.from);
}

type Mode = 'edit' | 'connect' | 'delete';

export function ConstellationEditor() {
  const { success, error: toastErr } = useToast();
  const [chars, setChars] = useState<CharOption[]>([]);
  const [slug, setSlug] = useState('');
  const [points, setPoints] = useState<Pt[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [source, setSource] = useState<'custom' | 'default' | ''>('');
  const [updatedAt, setUpdatedAt] = useState('');
  const [mode, setMode] = useState<Mode>('edit');
  const [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [importText, setImportText] = useState('');
  const [importMsg, setImportMsg] = useState<{ type: 'ok' | 'err'; lines: string[] } | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const dragId = useRef<string | null>(null);
  const moved = useRef(false);

  // 载入角色列表
  useEffect(() => {
    (async () => {
      try {
        const data = await api.get<unknown>('/api/admin/characters');
        const parsed = AdminCharactersListResponseSchema.parse(data);
        const opts = parsed.characters.map((ch) => ({ slug: ch.slug, name: ch.name }));
        setChars(opts);
        if (opts[0]) setSlug(opts[0].slug);
      } catch (e) {
        setErr((e as Error).message);
        toastErr('加载角色列表失败');
      } finally {
        setLoading(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 选中角色 → 载入其星座
  useEffect(() => {
    if (!slug) return;
    (async () => {
      try {
        const data = await api.get<unknown>(`/api/admin/constellations/${slug}`);
        const parsed = AdminConstellationResponseSchema.parse(data);
        setPoints(parsed.points.map((p) => ({ id: p.id, x: p.x, y: p.y })));
        setEdges(parsed.edges.map((e) => ({ from: e.from, to: e.to })));
        setSource(parsed.source);
        setUpdatedAt(parsed.updatedAt);
        setSelected(null);
      } catch (e) {
        toastErr(`加载星座失败：${(e as Error).message}`);
      }
    })();
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  // 屏幕坐标 → viewBox 坐标（getScreenCTM 自动消化 viewBox / 缩放）
  function toViewBox(clientX: number, clientY: number): { x: number; y: number } | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  function updatePoint(id: string, patch: Partial<Pt>) {
    setPoints((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  function removePoint(id: string) {
    setPoints((prev) => prev.filter((p) => p.id !== id));
    setEdges((prev) => prev.filter((e) => e.from !== id && e.to !== id));
    if (selected === id) setSelected(null);
  }

  function toggleEdge(a: string, b: string) {
    if (a === b) return;
    const candidate = { from: a, to: b };
    setEdges((prev) => {
      const exists = prev.some((e) => sameEdge(e, candidate));
      return exists ? prev.filter((e) => !sameEdge(e, candidate)) : [...prev, candidate];
    });
  }

  // —— 画布交互 ——
  function onBackgroundPointerDown(e: React.PointerEvent) {
    if (mode === 'edit') {
      const v = toViewBox(e.clientX, e.clientY);
      if (!v) return;
      setPoints((prev) => [...prev, { id: genId(prev), x: clampX(v.x), y: clampY(v.y) }]);
    } else if (mode === 'connect') {
      setSelected(null);
    }
  }

  function onNodePointerDown(e: React.PointerEvent, id: string) {
    e.stopPropagation();
    if (mode === 'delete') {
      removePoint(id);
      return;
    }
    if (mode === 'connect') {
      if (selected === null) setSelected(id);
      else { toggleEdge(selected, id); setSelected(null); }
      return;
    }
    // edit：开始拖拽
    dragId.current = id;
    moved.current = false;
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (mode !== 'edit' || dragId.current === null) return;
    const v = toViewBox(e.clientX, e.clientY);
    if (!v) return;
    moved.current = true;
    updatePoint(dragId.current, { x: clampX(v.x), y: clampY(v.y) });
  }

  function onPointerUp() {
    dragId.current = null;
  }

  async function handleSave() {
    if (!slug) return;
    if (!reason.trim()) { toastErr('请填写变更原因'); return; }
    const body = { points, edges, reason: reason.trim() };
    const check = AdminConstellationPutSchema.safeParse(body);
    if (!check.success) {
      toastErr(`数据校验失败：${check.error.issues[0]?.message ?? '未知错误'}`);
      return;
    }
    setBusy(true);
    try {
      const data = await api.put<unknown>(`/api/admin/constellations/${slug}`, check.data);
      const parsed = AdminConstellationResponseSchema.parse(data);
      setSource(parsed.source);
      setUpdatedAt(parsed.updatedAt);
      setReason('');
      success('星座已保存');
    } catch (e) {
      toastErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    if (!slug) return;
    if (!window.confirm(`确定重置「${slug}」为内置默认星座吗？此操作会删除已保存的自定义数据。`)) return;
    setBusy(true);
    try {
      await api.delete(`/api/admin/constellations/${slug}?reason=${encodeURIComponent('admin reset')}`);
      const data = await api.get<unknown>(`/api/admin/constellations/${slug}`);
      const parsed = AdminConstellationResponseSchema.parse(data);
      setPoints(parsed.points.map((p) => ({ id: p.id, x: p.x, y: p.y })));
      setEdges(parsed.edges.map((edge) => ({ from: edge.from, to: edge.to })));
      setSource(parsed.source);
      setUpdatedAt(parsed.updatedAt);
      setSelected(null);
      success('已重置为内置默认');
    } catch (e) {
      toastErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // 文本导入：解析行式 DSL → 校验 → 载入画布（不自动保存）
  function handleImport() {
    const r = parseConstellationDsl(importText);
    if (!r.ok || !r.data) {
      setImportMsg({ type: 'err', lines: r.errors });
      return;
    }
    // 与保存共用同一套 zod 兜底（含数量上限）
    const check = ConstellationSchema.safeParse(r.data);
    if (!check.success) {
      setImportMsg({ type: 'err', lines: check.error.issues.map((i) => i.message) });
      return;
    }
    setPoints(r.data.points.map((p) => ({ id: p.id, x: p.x, y: p.y })));
    setEdges(r.data.edges.map((e) => ({ from: e.from, to: e.to })));
    setSelected(null);
    setImportMsg({
      type: 'ok',
      lines: [`已载入 ${r.data.points.length} 个星点、${r.data.edges.length} 条连线，确认后填原因保存`],
    });
  }

  // 把当前画布导出为同格式 DSL：填入文本框并复制到剪贴板
  async function handleExport() {
    const text = serializeConstellationDsl({ points, edges });
    setImportText(text);
    setImportMsg(null);
    try {
      await navigator.clipboard.writeText(text);
      success('已复制当前星座文本');
    } catch {
      toastErr('已填入文本框（剪贴板不可用）');
    }
  }

  if (loading) {
    return <div className="state-placeholder"><Sparkles size={32} /><span>加载中…</span></div>;
  }
  if (err) {
    return <div className="state-placeholder state-error"><Circle size={32} /><span>{err}</span></div>;
  }

  const ptMap = new Map(points.map((p) => [p.id, p]));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sparkles size={18} /> 星座编辑器
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <select value={slug} onChange={(e) => setSlug(e.target.value)} style={{ minWidth: 180 }}>
            {chars.map((ch) => (
              <option key={ch.slug} value={ch.slug}>{ch.name}（{ch.slug}）</option>
            ))}
          </select>
          <span className={`badge ${source === 'custom' ? 'badge-ok' : 'badge-warn'}`}>
            {source === 'custom' ? '已自定义' : '默认（未保存）'}
          </span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) 320px', gap: 16, alignItems: 'start' }}>
        {/* 画布 */}
        <div className="card" style={{ padding: 12 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            {([['edit', '添加 / 移动'], ['connect', '连线'], ['delete', '删除']] as [Mode, string][]).map(([m, label]) => (
              <button
                key={m}
                className={`btn btn-sm ${mode === m ? 'btn-primary' : ''}`}
                onClick={() => { setMode(m); setSelected(null); }}
              >
                {label}
              </button>
            ))}
            <span style={{ color: 'var(--muted, #888)', fontSize: 12, alignSelf: 'center', marginLeft: 4 }}>
              {mode === 'edit' && '点击空白加星点，拖拽星点移动'}
              {mode === 'connect' && (selected ? `已选 ${selected}，点另一个星点连线` : '依次点两个星点连线（再点一次取消）')}
              {mode === 'delete' && '点星点删点，点连线删线'}
            </span>
          </div>

          <svg
            ref={svgRef}
            viewBox="-6 -46 112 152"
            style={{
              width: '100%',
              aspectRatio: '112 / 152',
              background: 'radial-gradient(ellipse 70% 60% at 50% 55%, #221c2e, #14101c)',
              borderRadius: 8,
              touchAction: 'none',
              cursor: mode === 'edit' ? 'crosshair' : 'default',
            }}
            onPointerDown={onBackgroundPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          >
            {/* 卡片边界参考框（0..100 × 0..100），上方为浮空区 */}
            <rect x={0} y={-40} width={100} height={140} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={0.4} />
            <rect x={0} y={0} width={100} height={100} fill="rgba(255,255,255,0.025)" stroke="rgba(233,216,176,0.18)" strokeWidth={0.5} strokeDasharray="2 2" />
            <line x1={0} y1={0} x2={100} y2={0} stroke="rgba(233,216,176,0.28)" strokeWidth={0.5} />

            {/* 连边 */}
            <g stroke={GOLD_GLOW} strokeWidth={0.6} opacity={0.7}>
              {edges.map((edge, idx) => {
                const a = ptMap.get(edge.from);
                const b = ptMap.get(edge.to);
                if (!a || !b) return null;
                return (
                  <g key={`edge-${idx}`}>
                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
                    {mode === 'delete' && (
                      <line
                        x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                        stroke="transparent" strokeWidth={4}
                        style={{ cursor: 'pointer' }}
                        onPointerDown={(e) => { e.stopPropagation(); setEdges((prev) => prev.filter((x) => !sameEdge(x, edge))); }}
                      />
                    )}
                  </g>
                );
              })}
            </g>

            {/* 星点 */}
            {points.map((p) => {
              const isSel = selected === p.id;
              return (
                <g key={p.id} style={{ cursor: mode === 'edit' ? 'grab' : 'pointer' }} onPointerDown={(e) => onNodePointerDown(e, p.id)}>
                  <circle cx={p.x} cy={p.y} r={3.6} fill={GOLD_GLOW} opacity={0.18} />
                  <circle cx={p.x} cy={p.y} r={1.8} fill={GOLD_LIGHT} opacity={0.42} />
                  <circle cx={p.x} cy={p.y} r={0.85} fill="#ffffff" />
                  {/* 选中高亮环 */}
                  {isSel && <circle cx={p.x} cy={p.y} r={4.6} fill="none" stroke={GOLD_LIGHT} strokeWidth={0.6} />}
                  {/* 加大的透明命中区 */}
                  <circle cx={p.x} cy={p.y} r={5} fill="transparent" />
                  <text x={p.x + 2.2} y={p.y - 2.2} fontSize={3.2} fill="rgba(233,216,176,0.7)" style={{ userSelect: 'none', pointerEvents: 'none' }}>{p.id}</text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* 右侧：精确编辑 + 操作 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>星点（{points.length}）</div>
            <div style={{ display: 'grid', gap: 6, maxHeight: 240, overflowY: 'auto' }}>
              {points.length === 0 && <div style={{ color: 'var(--muted, #888)', fontSize: 12 }}>暂无星点，在左侧画布点击添加</div>}
              {points.map((p) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12, width: 28 }}>{p.id}</span>
                  <label style={{ fontSize: 11, color: 'var(--muted,#888)' }}>x</label>
                  <input
                    type="number" value={p.x} min={X_MIN} max={X_MAX} step={1}
                    onChange={(e) => updatePoint(p.id, { x: clampX(Number(e.target.value)) })}
                    style={{ width: 64 }}
                  />
                  <label style={{ fontSize: 11, color: 'var(--muted,#888)' }}>y</label>
                  <input
                    type="number" value={p.y} min={Y_MIN} max={Y_MAX} step={1}
                    onChange={(e) => updatePoint(p.id, { y: clampY(Number(e.target.value)) })}
                    style={{ width: 64 }}
                  />
                  <button className="btn btn-sm btn-danger" title="删除星点" onClick={() => removePoint(p.id)}>
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>连边（{edges.length}）</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {edges.length === 0 && <div style={{ color: 'var(--muted, #888)', fontSize: 12 }}>暂无连边，用「连线」模式连接星点</div>}
              {edges.map((e, idx) => (
                <span key={`${e.from}-${e.to}-${idx}`} className="badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {e.from}–{e.to}
                  <button
                    onClick={() => setEdges((prev) => prev.filter((_, i) => i !== idx))}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, lineHeight: 1 }}
                    title="删除连边"
                  >×</button>
                </span>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: 12 }}>
            <div className="field" style={{ marginBottom: 10 }}>
              <label>变更原因（必填）</label>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例如：调整沈言志星座弧度" />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" onClick={handleSave} disabled={busy}>
                <Save size={14} /> 保存
              </button>
              <button className="btn" onClick={handleReset} disabled={busy || source !== 'custom'} title={source === 'custom' ? '' : '当前已是默认'}>
                <RotateCcw size={14} /> 重置为默认
              </button>
            </div>
            {updatedAt && <div style={{ fontSize: 11, color: 'var(--muted,#888)', marginTop: 8 }}>上次保存：{formatDateTime(updatedAt)}</div>}
          </div>
        </div>
      </div>

      {/* 文本导入 / 导出 */}
      <div className="card" style={{ padding: 12, marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            <FileInput size={15} /> 文本导入
          </div>
          <span style={{ fontSize: 12, color: 'var(--muted,#888)' }}>
            行式格式：星点「id x y」每行一个，连线「A-B」；# 为注释。详见 docs/tech/星座数据格式规范.md
          </span>
        </div>
        <textarea
          value={importText}
          onChange={(e) => { setImportText(e.target.value); setImportMsg(null); }}
          placeholder={'# 星点 id x y\nA 50 -25\nB 25 -10\nC 75 -10\n\n# 连线\nA-B\nA-C'}
          rows={8}
          style={{ width: '100%', fontFamily: 'var(--font-mono, monospace)', fontSize: 12, resize: 'vertical' }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={handleImport} disabled={!importText.trim()}>
            <FileInput size={14} /> 解析并载入
          </button>
          <button className="btn" onClick={handleExport}>
            <Copy size={14} /> 复制为文本
          </button>
        </div>
        {importMsg && (
          <div style={{ marginTop: 8, fontSize: 12, color: importMsg.type === 'ok' ? 'var(--ok, #4a9)' : 'var(--danger, #c66)' }}>
            {importMsg.type === 'ok' ? (
              importMsg.lines[0]
            ) : (
              <div>
                <div style={{ marginBottom: 4 }}>解析失败（{importMsg.lines.length}）：</div>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {importMsg.lines.slice(0, 20).map((l, i) => <li key={i}>{l}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
