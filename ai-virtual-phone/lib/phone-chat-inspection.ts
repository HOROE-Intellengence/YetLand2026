import type { ChatSession, ChatMessage, ChatContact } from './chat-storage';
import { inspectionRecord } from './phone-inspection-records';
import type { PhoneInspectionRecord } from '../../packages/shared/src/contracts/phone';

// Fixed-size sections retain every final device message without confusing
// provider request histories with the bubbles actually shown on the phone.
export function chatInspectionRecords(snapshot: {sessions:ChatSession[];messages:ChatMessage[];contacts:ChatContact[]}):PhoneInspectionRecord[] {
  const rows:PhoneInspectionRecord[]=[];
  for(const session of snapshot.sessions){
    const messages=snapshot.messages.filter(m=>m.sessionId===session.id && m.role!=='tool' && !['tool_call','tool_result','system_instruction'].includes(m.mediaType||'')).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
    const contact=snapshot.contacts.find(c=>c.id===session.contactId),characterId=contact?.characterId||session.contactId;
    const name=session.groupName||session.alias||contact?.nickname||'聊天会话',count=Math.max(1,Math.ceil(messages.length/50));
    for(let part=0;part<count;part++){
      const block=messages.slice(part*50,(part+1)*50);
      const row=inspectionRecord('chat','chat',{...session,id:`${session.id}:${part}`,characterId,memberIds:session.participantIds,title:`${name}${count>1?` · ${part+1}/${count}`:''}`,sessionId:session.id,partIndex:part,partCount:count,totalMessages:messages.length,messages:block},[{title:'聊天正文',text:block.map(m=>`${m.senderName||(m.role==='user'?'用户':'角色')} · ${m.createdAt}\n${m.content||''}${m.mediaType?`\n〔${m.mediaType}〕`:''}`).join('\n\n')}]);
      if(row)rows.push(row);
    }
  }
  return rows;
}
