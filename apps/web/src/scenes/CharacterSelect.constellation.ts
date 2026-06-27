// 星座取数 —— 类型与内置默认数据均来自 @yelan/shared（唯一真理源）。
// 运营在 admin 编辑后，公共角色列表会把 constellation join 进每张角色卡；
// 这里优先用角色卡上的 constellation，缺省再回退内置默认。
import type { Character } from '@yelan/shared';
import { getDefaultConstellation } from '@yelan/shared';

export type { Constellation, ConstellationPoint, ConstellationEdge } from '@yelan/shared';

/**
 * 解析某角色的星座：优先用后端 join 进来的持久化数据，缺省回退内置默认。
 */
export function resolveConstellation(character: Pick<Character, 'constellation' | 'slug' | 'id'>) {
  return character.constellation ?? getDefaultConstellation(character.slug || character.id || '');
}
