import type { Character } from './character-types';
import type { DiaryEntry } from './diary-entry-types';
import type { XiaohongshuNote } from './xiaohongshu-types';
import type { DwellingLayout } from './dwelling-storage';

export function createStarterDiaryEntries(characters: Character[]): DiaryEntry[] {
  const now = new Date().toISOString();
  return characters.map(character => ({
    id: `starter-diary:${character.id}`, characterId: character.id, characterName: character.name,
    title: '初始手记 · 给日常留一点空白', dateLabel: '初始示例', mood: '平静', weather: '晴', tags: ['初始示例'],
    body: '这是一本等待写下故事的手记。\n\n一杯茶、几页书、一段散步的路，都可以成为值得留下的片刻。\n\n这篇是初始示例。点击生成，让角色写下属于自己的日常。',
    blocks: [{ type: 'paragraph', text: '这是一本等待写下故事的手记。' }, { type: 'paragraph', text: '一杯茶、几页书、一段散步的路，都可以成为值得留下的片刻。' }, { type: 'quote', text: '初始示例。点击生成，让角色写下属于自己的日常。' }],
    trigger: 'manual', createdAt: now, updatedAt: now,
  }));
}

export function createStarterXiaohongshuNotes(): XiaohongshuNote[] {
  const now = new Date().toISOString();
  const cards = [
    ['窗边的十分钟', '把手机调成静音，泡一杯热茶。读几页书，也可以什么都不做。', '🌤️', 'mist'],
    ['周末散步清单', '沿河走一段，逛一家小店，带回路上发现的小惊喜。', '🌿', 'ivory'],
    ['桌面只留下喜欢的东西', '一本手帐、一盏灯、一个顺手的杯子。让小小的桌面成为自己的角落。', '📓', 'blush'],
    ['晚饭后的慢时光', '不急着安排明天。听一首歌，把今天开心的事写下来。', '🌙', 'graphite'],
    ['给日常留一点光', '透过树叶的阳光，和不赶时间的脚步。', '🍃', 'mist'],
    ['一杯茶的时间', '热水升起薄雾，书翻到下一页。', '🍵', 'ivory'],
    ['没有计划的下午', '从熟悉的街道拐向一条新路，在转角遇见一家书店。', '🚶', 'blush'],
    ['把今天写在纸上', '一张照片，一段小记，把容易忘记的瞬间留下来。', '✍️', 'ivory'],
    ['树影摇晃的十秒', '放慢呼吸，听见叶子与风的声音。', '🌳', 'mist'],
    ['街角的灯亮了', '天色变蓝的时候，窗户里透出温暖的光。', '🏠', 'graphite'],
  ] as const;
  return cards.map(([title, body, coverIcon, tone], i) => ({
    id: `starter-xhs-${i}`, type: i >= 8 ? 'video' : 'post', source: 'npc', feedScope: i % 2 ? 'nearby' : 'discover',
    authorId: `starter-npc-${i}`, authorName: ['日常收藏家', '散步指南', '桌边小记'][i % 3],
    title, body: `${body}\n\n初始示例，刷新后发现更多内容。`, videoDescription: i >= 8 ? body : undefined,
    coverIcon, tone, tags: ['日常', '初始示例'], likeCount: 0, saveCount: 0, commentCount: 0,
    liked: false, saved: false, recentLikeNames: [], recentSaveNames: [], comments: [], createdAt: now, updatedAt: now,
  }));
}

export function createStarterDwelling(): DwellingLayout {
  return { rooms: [{
    id: 'starter-room', name: '窗边小屋', en: 'A QUIET CORNER',
    description: '初始示例 · 暖光、书页和一杯茶。刷新后探索角色自己的栖所。',
    furniture: [
      { id: 'starter-desk', icon: '🪑', label: '书桌', en: 'DESK', position: 'center-left', marker: { x: .3, y: .45 }, items: [{ id: 'starter-book', name: '翻开的书', preview: '书页里留着一张素色书签。' }, { id: 'starter-note', name: '手帐', preview: '新的一页，等着写下今天的片刻。' }] },
      { id: 'starter-window', icon: '🪟', label: '窗台', en: 'WINDOW', position: 'top-right', marker: { x: .7, y: .3 }, items: [{ id: 'starter-plant', name: '小盆栽', preview: '几片新叶朝着光舒展。' }] },
      { id: 'starter-table', icon: '☕', label: '茶几', en: 'TEA TABLE', position: 'bottom-center', marker: { x: .5, y: .7 }, items: [{ id: 'starter-tea', name: '陶瓷杯', preview: '温热的茶香，和不赶时间的午后。' }] },
    ],
  }] };
}

export function createStarterItemHtml(layout: DwellingLayout): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const room of layout.rooms) for (const furniture of room.furniture) for (const item of furniture.items) {
    entries[`${room.id}_${item.id}`] = `<article style="padding:24px;font-family:system-ui;line-height:1.8;color:#343434;background:#faf8f3;border-radius:16px"><small>初始示例</small><h2>${item.name}</h2><p>${item.preview}</p><p>刷新栖所后，这里会出现角色专属的物品与故事。</p></article>`;
  }
  return entries;
}
