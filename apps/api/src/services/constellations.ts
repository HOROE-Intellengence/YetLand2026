// 介绍页星座 service —— 独立存储（state.constellations，按角色 slug），与角色卡分表。
// 不做 seed：未编辑过的角色由 resolve() 回退内置默认（@yelan/shared），
// 因此 state 里只沉淀「运营真正改过」的星座，迁移/回滚都干净。
import { getDefaultConstellation, type Constellation } from '@yelan/shared';
import { store, type ConstellationRow } from '../store/persistence';

function now(): string {
  return new Date().toISOString();
}

export interface ResolvedConstellation extends Constellation {
  slug: string;
  /** custom = 已持久化的运营编辑；default = 返回的是内置默认（尚未保存） */
  source: 'custom' | 'default';
  updatedAt: string;
}

export const constellationsService = {
  /** 列出所有已自定义（持久化）的星座；运营面板用 */
  listAll(): ConstellationRow[] {
    return Object.values(store.state().constellations);
  },

  /** 取持久化记录（无则 null） */
  get(slug: string): ConstellationRow | null {
    return store.state().constellations[slug] ?? null;
  },

  /** 渲染取数：持久化优先，缺省回退内置默认 —— 绝不返回空。 */
  resolve(slug: string): Constellation {
    const row = store.state().constellations[slug];
    return row ? { points: row.points, edges: row.edges } : getDefaultConstellation(slug);
  },

  /** 编辑器载入：在 resolve 基础上附带 source/updatedAt，便于区分默认与自定义。 */
  resolveDetailed(slug: string): ResolvedConstellation {
    const row = store.state().constellations[slug];
    if (row) {
      return { slug, points: row.points, edges: row.edges, source: 'custom', updatedAt: row.updatedAt };
    }
    const def = getDefaultConstellation(slug);
    return { slug, points: def.points, edges: def.edges, source: 'default', updatedAt: '' };
  },

  /** 创建或全量替换某 slug 的星座。 */
  upsert(slug: string, data: Constellation): ConstellationRow {
    const row: ConstellationRow = { slug, points: data.points, edges: data.edges, updatedAt: now() };
    store.state().constellations[slug] = row;
    store.save();
    return row;
  },

  /** 删除持久化记录 → 该 slug 回退内置默认。 */
  remove(slug: string): boolean {
    const s = store.state();
    if (!s.constellations[slug]) return false;
    delete s.constellations[slug];
    store.save();
    return true;
  },
};
