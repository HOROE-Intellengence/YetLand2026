import type { DwellingLayout } from './dwelling-storage';

// Export only fictional layout text, never image blobs or generated item HTML.
export function dwellingMemoryEntry(characterId: string, saved: { layout: DwellingLayout; updatedAt: string } | null) {
  if (!saved?.layout.rooms.length) return null;
  return {
    id: `dwelling:${characterId}`, sourceApp: 'dwelling', sessionId: undefined,
    timestamp: saved.updatedAt,
    content: ['这是 AI 虚拟角色的栖所设定，不是现实用户的住址或真实生活事实。以下为当前布局：',
      ...saved.layout.rooms.map(room => [
        `房间：${room.name}。${room.description}`,
        ...room.furniture.map(item => `家具：${item.label}；物品：${item.items.map(value => value.name).join('、') || '无'}`),
      ].join('\n')),
    ].join('\n'),
  };
}
