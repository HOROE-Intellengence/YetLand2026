import { latestUserInput, readingBlocks, type ReadingBlock } from './record-reader';

export const phoneSourceNames: Record<string, string> = {
  chat: '聊天', group: '群聊', group_chat:'群聊', game: '游戏', story: '故事', vn: '视觉小说', map: '冒险',
  interview: '访谈', interview_magazine:'访谈', douyin: '抖音', xiaohongshu: '小红书', shopping: '购物',shopping_search:'购物搜索',
  cocreate: '共创', memory: '记忆整理', unknown: '未识别',
};
export function phoneSourceLabel(source:string):string{return phoneSourceNames[source]|| (source.startsWith('custom_app:')?`自定义应用 · ${source.slice(-6)}`:source);}
export function inferPhoneSource(request: string, branch = ''): string {
  const prefix = branch.split(':')[0] ?? '';
  if (['game', 'story', 'vn', 'map'].includes(prefix)) return prefix;
  let messages: { role?: string; content?: unknown }[];
  try { const value = JSON.parse(request); messages = Array.isArray(value) ? value : value.messages; } catch { return 'unknown'; }
  if (!Array.isArray(messages)) return 'unknown';
  const original = messages.slice(1).filter(m => m.role === 'system' || m.role === 'user').map(m => typeof m.content === 'string' ? m.content : '').join('\n');
  if (/\[抖音\]|你是「抖音」/.test(original)) return 'douyin';
  if (/\[TA的SillyTavern\]/.test(original)) return 'TA的SillyTavern';
  if (/你是杂志《在场 PRESENCE》/.test(original)) return 'interview';
  if (/<shopping_refresh_instruction>/.test(original)) return 'shopping';
  return 'unknown';
}
export function completionContent(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  let text = value;
  if (/^\s*(?:data:|event:)/m.test(text)) {
    text = text.split(/\r?\n\r?\n/).map(frame => {
      const data = frame.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
      try { const o = JSON.parse(data); return o.choices?.[0]?.delta?.content ?? o.choices?.[0]?.message?.content ?? ''; } catch { return ''; }
    }).join('');
  } else {
    try { const o = JSON.parse(text); text = o.choices?.[0]?.message?.content ?? text; } catch { /* Plain content. */ }
  }
  if (typeof text !== 'string') return text;
  const clean = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(clean); } catch { return text; }
}
export function semanticPhoneBlocks(value: unknown): ReadingBlock[] {
  const content = completionContent(value);
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    const o = content as Record<string, unknown>;
    if ('say' in o && 'choice' in o) return [{ label: '出牌', text: String(o.choice) }, ...readingBlocks(o.say, '角色吐槽')];
    if (Array.isArray(o.actions)) return o.actions.length ? o.actions.flatMap(action => {
      const a = action as Record<string, unknown>;
      return [{ label: ({ like: '点赞', comment: '评论', reply: '回复' } as Record<string, string>)[String(a.type)] ?? '互动', text: String(a.text || (a.postId ? `作品 ${a.postId}` : a.type || '互动记录')) }];
    }) : [{ label: '互动', text: '本轮没有执行互动动作。' }];
    if ('userReply' in o || 'charResponse' in o) return [
      ...readingBlocks(o.userReply, '玩家'), ...readingBlocks(o.charResponse, '角色'),
      ...readingBlocks(o.userSendOs, '玩家内心'), ...readingBlocks(o.ownerReadOs, '角色内心'),
    ];
    if (Array.isArray(o.messages) && o.messages.every(m => typeof m === 'string')) return o.messages.map(text => ({ label: '角色私信', text: String(text) }));
    if ('first_mes' in o) return ['name', 'description', 'personality', 'scenario', 'first_mes', 'userPersona'].flatMap(key => readingBlocks(o[key], ({name:'角色名',description:'角色说明',personality:'性格',scenario:'场景',first_mes:'开场白',userPersona:'玩家设定'} as Record<string,string>)[key]!));
    if ('question' in o) return [...readingBlocks(o.intro, '主持人开场'), ...readingBlocks(o.question, '主持人提问')];
  }
  return readingBlocks(content,'角色');
}
export function phonePreviewText(value: unknown): string {
  return semanticPhoneBlocks(value).map(b => b.text).join(' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
}
export function phoneInputPreview(request: string): string { return phonePreviewText(latestUserInput(request)); }
