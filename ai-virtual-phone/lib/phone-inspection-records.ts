import type { PhoneInspectionRecord } from '../../packages/shared/src/contracts/phone';

type Row = Record<string, unknown>;
const labels: Record<string, string> = {
  name: '名称', title: '标题', description: '背景说明', persona: '角色设定', content: '内容', body: '正文',
  text: '文本', rawContent: '原文', summary: '摘要', storySummary: '剧情摘要', chapters: '章节',
  messages: '对话', role: '发言身份', world: '世界设定', lore: '世界背景', skeleton: '世界架构',
  relations: '人物关系', label: '关系', cast: '人物档案', journal: '冒险日志', subtitle: '副标题',
  key: '触发词', entries: '世界书条目', memberIds: '关联角色', pattern: '文本匹配规则', replacement: '替换内容',
  preset: '补充设定', worldBook: '世界书', regexes: '文本规则', transcript: '访谈实录',
  paragraphs: '段落', writerNotebook: '作者笔记', relationshipDossier: '关系档案', notes: '笔记', secret: '剧情暗线',
};
const excluded = /^(?:apiKey|apiConfig|baseUrl|authorization|token|accessToken|refreshToken|password|passwordHash|cookie|clientSecret|secretKey|signingKey|credentials|backendLogs|toolDebugs|toolArtifacts|nativeToolCalls|nativeToolResult|nativeToolReasoning|rawOutputs|imageData|audioDataUrl|frameAudio|customCSS|geometry|mapData|svg|geojson|seed|revision|parserVersion|regexSignature)$/i;
export function inspectionText(value: unknown, depth = 0): string {
  if (depth > 12 || value == null) return '';
  if (typeof value === 'string') return value.replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, '[密钥已隐藏]').replace(/Bearer\s+[A-Za-z0-9._-]{20,}/gi, 'Bearer [已隐藏]').replace(/data:[^\s]{100,}/g, '[内嵌媒体已省略]');
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(item => inspectionText(item, depth + 1)).filter(Boolean).join('\n\n');
  if (typeof value === 'object') return Object.entries(value as Row).filter(([key]) => !excluded.test(key))
    .map(([key, item]) => { const text = inspectionText(item, depth + 1); return text ? `${labels[key] || key}：${text}` : ''; }).filter(Boolean).join('\n');
  return '';
}
export function inspectionRecord(source: string, kind: PhoneInspectionRecord['kind'], row: Row, sections?: PhoneInspectionRecord['sections']): PhoneInspectionRecord | null {
  const id = String(row.id || row.uid || row.sessionId || '').slice(0, 200);
  if (!id) return null;
  const characters = [row.characterId, row.partnerCharacterId, ...(Array.isArray(row.memberIds) ? row.memberIds : [])]
    .filter((value): value is string => typeof value === 'string' && Boolean(value)).slice(0, 30);
  const rawSections = sections ?? Object.entries(row).filter(([key]) => !excluded.test(key) && !['id', 'uid', 'createdAt', 'updatedAt', 'characterId', 'partnerCharacterId'].includes(key))
    .map(([key, value]) => ({ title: labels[key] || key, text: inspectionText(value) })).filter(section => section.text);
  let remaining = 500000, truncated = rawSections.length > 100;
  const bounded = rawSections.slice(0, 100).map(section => {
    const text = inspectionText(section.text), max = Math.min(200000, remaining);
    if (text.length > max) truncated = true;
    remaining -= Math.min(max, text.length);
    return { title: section.title.slice(0, 300), text: text.slice(0, max) };
  });
  return { source, id, kind, title: String(row.title || row.name || row.subtitle || '未命名内容').slice(0, 300),
    characterIds: [...new Set(characters)], sections: bounded,
    localUpdatedAt: String(row.updatedAt || row.timestamp || row.createdAt || '').slice(0, 100), deleted: false, truncated };
}
const kvSources: Record<string, { kind: PhoneInspectionRecord['kind']; field?: string; title: string }> = {
  'yelan-phone-diagnostics-v1': { kind: 'diagnostic', title: '运行诊断' },
  ai_phone_characters_v1: { kind: 'role', title: '角色' },
  ai_phone_character_worlds_v1: { kind: 'worldview', title: '世界观' },
  map_dm_prompts: { kind: 'worldview', title: '冒险创作要求' },
  ai_phone_cocreate_library_v1: { kind: 'cocreate', field: 'sessions', title: '共创作品' },
  ai_phone_diary_entries_v1: { kind: 'diary', title: '日记' },
  ai_phone_interview_magazine_issues_v1: { kind: 'interview', title: '访谈作品' },
  ai_phone_interview_magazine_drafts_v1: { kind: 'interview', title: '访谈草稿' },
  ai_phone_game_hall_drafts_v1: { kind: 'game', title: '游戏草稿' },
  ai_phone_game_state_v1: { kind: 'game', field: 'saves', title: '游戏存档' },
  ai_phone_custom_apps_v1: { kind: 'custom-app', title: '自定义 App' },
  ai_phone_calendar_plans_v1: { kind: 'note', title: '日程' },
  ai_phone_black_market_scene_sessions_v1: { kind: 'story', title: '剧情场景' },
  ai_phone_shopping_state_v1: { kind: 'note', title: '购物内容' },
  ai_phone_xiaohongshu_state_v1: { kind: 'note', title: '小红书内容' },
};
export function kvInspectionRecords(key: string, value: string): PhoneInspectionRecord[] {
  const source = kvSources[key];
  if (!source) return [];
  let data: unknown;
  try { data = JSON.parse(value); } catch { return []; }
  if (source.field && data && typeof data === 'object') data = (data as Row)[source.field];
  const rows = Array.isArray(data) ? data : data && typeof data === 'object' ? [{ ...(data as Row), id: key, title: source.title }] : [];
  return rows.filter((row): row is Row => Boolean(row) && typeof row === 'object')
    .filter(row => !(key === 'ai_phone_characters_v1' && row.canEdit === false))
    .map(row => {
      if (source.kind !== 'cocreate') return inspectionRecord(key, source.kind, row);
      const chapters = Array.isArray(row.chapters) ? row.chapters as Row[] : [];
      const messages = Array.isArray(row.messages) ? row.messages as Row[] : [];
      return inspectionRecord(key, source.kind, row, [
        ...chapters.map(chapter => ({ title: `第 ${chapter.num || ''} 章 · ${chapter.title || '未命名章节'}`, text: [chapter.content, chapter.summary ? `章节摘要：${chapter.summary}` : ''].filter(Boolean).join('\n\n') })),
        { title: '人物档案', text: inspectionText(row.cast) },
        { title: '人物关系', text: inspectionText(row.relationshipDossier) },
        { title: '作者笔记', text: inspectionText(row.writerNotebook) },
        { title: '剧情摘要', text: inspectionText(row.rollingSummary) },
        { title: '共创对话', text: messages.filter(message => message.role === 'user' || message.role === 'assistant').map(message => `${message.role === 'user' ? '用户' : '共创搭档'}\n${inspectionText(message.content)}`).join('\n\n') },
      ].filter(section => section.text));
    }).filter((row): row is PhoneInspectionRecord => Boolean(row));
}
