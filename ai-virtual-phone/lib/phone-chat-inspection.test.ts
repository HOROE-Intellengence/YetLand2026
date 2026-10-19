import { expect,it } from 'vitest';
import { chatInspectionRecords } from './phone-chat-inspection';
import type { ChatSession,ChatMessage } from './chat-storage';

it('retains final device messages across every page with their original media references',()=>{
  const session={id:'session-a',contactId:'contact-a',alias:'合成会话',updatedAt:'2026-10-18',unreadCount:0} as ChatSession;
  const messages=Array.from({length:127},(_,i)=>({id:`message-${String(i).padStart(3,'0')}`,sessionId:session.id,role:i%2?'assistant':'user',content:`第 ${i} 条`,status:'sent',createdAt:new Date(Date.UTC(2026,9,18,0,i)).toISOString(),...(i===126?{mediaType:'image',mediaUrl:'data:image/png;base64,aGVsbG8='}:{})})) as ChatMessage[];
  const rows=chatInspectionRecords({sessions:[session],messages,contacts:[{id:'contact-a',characterId:'character-a',addedAt:'2026-10-18'}]});
  expect(rows).toHaveLength(3);expect(rows.map(r=>r.characterIds)).toEqual([['character-a'],['character-a'],['character-a']]);
  const retained=rows.flatMap(r=>r.preview!.data.messages as ChatMessage[]);
  expect(retained.map(m=>m.id)).toEqual(messages.map(m=>m.id));expect(retained.at(-1)?.mediaUrl).toContain('data:image/png');
  expect(rows.at(-1)?.preview?.data.partCount).toBe(3);
});
