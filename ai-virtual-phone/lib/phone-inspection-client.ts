import type { PhoneInspectionRecord } from '../../packages/shared/src/contracts/phone';
import { kvEntries, kvGet, kvSet, isKvHydrated } from './kv-db';
import { isYelanManaged, yelanHeaders } from './yelan-managed-client';
import { inspectionRecord, inspectionText, kvInspectionRecords } from './phone-inspection-records';
import { createInspectionPreview, prepareInspectionPreview } from './phone-inspection-preview';
import { chatInspectionRecords } from './phone-chat-inspection';
const stateKey = 'yelan-inspection-delivery-v1';
type DeliveryState = { deviceId: string; revision: number; formatVersion?:number; hashes: Record<string, string>; summaries: Record<string, Omit<PhoneInspectionRecord, 'sections'>> };
let started = false, busy = false, wakeup: ReturnType<typeof setTimeout> | undefined;
let ownerUserId = '', delivery: DeliveryState;
const deliveredAssets = new Set<string>();
const remoteAssets = new Map<string,Promise<{id:string;mime:string}>>();
const identity = (row: PhoneInspectionRecord) => `${row.source}:${row.id}`;
const hash = async (row: PhoneInspectionRecord) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(row))))).map(value => value.toString(16).padStart(2, '0')).join('');

async function collect(): Promise<PhoneInspectionRecord[]> {
  const rows = kvEntries().flatMap(entry => kvInspectionRecords(entry.key, entry.value));
  rows.push(...chatInspectionRecords(await (await import('./chat-db')).readChatInspectionSnapshot()));
  const moments=await (await import('./moments-db')).readMomentsInspectionSnapshot();
  for(const post of moments.posts){
    const row=inspectionRecord('moments','note',{...post,title:post.content.slice(0,60)||'朋友圈动态',characterId:post.authorType==='character'?post.authorId:undefined,role:post.authorType==='user'?'user':'assistant',notes:[{...post,title:post.content.slice(0,60)||'朋友圈动态',body:post.content,imageUrl:post.photoUrl,comments:moments.comments.filter(c=>c.postId===post.id).map(c=>({...c,authorName:c.authorName||c.authorId,text:c.content}))}]});
    if(row)rows.push(row);
  }
  const themeStore=await import('./theme-storage');
  const themeProfile=themeStore.readThemeProfile();
  const themeRow=rows.find(row=>row.source==='ai_phone_theme_profile_v1');
  if(themeRow?.preview)themeRow.preview.data.resourceAssetIds=themeStore.collectThemeAssetIds(themeProfile);
  const snapshotScenes = (()=>{try{return JSON.parse(kvGet('yelan-inspection-scenes-v1')||'{}') as Record<string,{html:string;at:string}[]>;}catch{return {};}})();
  for(const row of rows){
    if(row.kind==='custom-app'&&row.preview){
      const prefix=`ai_phone_custom_app_data_v1:${row.id}/`;
      const collections:Record<string,unknown>={};
      for(const entry of kvEntries().filter(e=>e.key.startsWith(prefix))){try{collections[entry.key.slice(prefix.length)]=JSON.parse(entry.value);}catch{/*Ignore invalid local records.*/}}
      row.preview.data.collections=collections;
      row.preview.data.scenes=snapshotScenes[row.id]||[];
    }
    if(row.kind==='game'&&row.preview)row.preview.data.scenes=snapshotScenes[String(row.preview.data.localGameId||row.id)]||[];
  }
  const [story, vn, map, settings, reading] = await Promise.all([import('./story-storage'), import('./vn-storage'), import('./map-storage'), import('./settings-db'), import('./reading-storage')]);
  const [storyData, vnData, mapData, readingData] = await Promise.all([story.readStoryInspectionSnapshot(), vn.readVnInspectionSnapshot(), map.readMapInspectionSnapshot(), reading.readReadingInspectionSnapshot()]);
  for (const session of storyData.sessions) {
    const messages = storyData.messages.filter(message => message.sessionId === session.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const row = inspectionRecord('story', 'story', { ...session, title: session.title || '角色故事' }, [{ title: '故事正文', text: messages.map(message => `${message.role === 'user' ? '用户' : '角色'} · ${message.createdAt}\n${message.rawContent}`).join('\n\n') }]);
    if (row) rows.push(row);
    if(row?.preview)row.preview.data.messages=messages;
  }
  for (const session of vnData.sessions) {
    const messages = vnData.messages.filter(message => message.sessionId === session.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const row = inspectionRecord('vn', 'vn', { ...session, title: session.chapters[0]?.title || '视觉小说' }, [
      { title: '章节', text: inspectionText(session.chapters) },
      { title: '剧情正文', text: messages.map(message => `第 ${message.chapterIndex + 1} 章 · ${message.role}\n${message.rawContent}`).join('\n\n') },
    ]);
    if (row) rows.push(row);
    if(row?.preview){
      row.preview.data.messages=messages;
      const assets=await import('./vn-asset-storage');
      row.preview.data.scenes=assets.loadVnScenes(session.characterId);
      row.preview.data.sprites=assets.loadVnSprites(session.characterId);
      const parser=await import('./vn-parser');
      row.preview.data.frames=messages.flatMap(message=>parser.parseVnResponse(message.rawContent).frames.map((frame,index)=>({...frame,role:message.role,voiceAudio:message.frameAudio?.[index]})));
      const lastAssistant=[...messages].reverse().find(message=>message.role==='assistant');
      row.preview.data.options=lastAssistant?parser.parseVnResponse(lastAssistant.rawContent).options:null;
    }
  }
  for (const world of mapData.worlds) {
    const row = inspectionRecord('adventure-world', 'worldview', { ...world, title: world.skeleton?.world?.name || '冒险世界' });
    if (row) rows.push(row);
    for (const save of mapData.saves.filter(save => save.worldId === world.id)) {
      const snapshot = inspectionRecord('adventure-save', 'adventure', { ...save, title: row?.title || '冒险记录' });
      if (snapshot) rows.push(snapshot);
    }
  }
  for (const world of settings.readWorldBooksCache()) {
    const row = inspectionRecord('worldbook', 'worldview', world as unknown as Record<string, unknown>);
    if (row && world.entries.length) { const roleId = /^yelan:(.+):worldbook$/.exec(world.id)?.[1]; if (roleId) row.characterIds = [roleId]; rows.push(row); }
  }
  for (const preset of settings.readPresetsCache().filter(item => !item.builtIn && !item.id.startsWith('yelan:'))) {
    const row = inspectionRecord('custom-preset', 'role', { ...preset, title: `用户预设 · ${preset.name}` }); if (row) rows.push(row);
  }
  for (const regex of settings.readRegexesCache().filter(item => !item.id.startsWith('yelan:'))) {
    const row = inspectionRecord('custom-regex', 'role', { ...regex, title: `文本规则 · ${regex.name}` }); if (row) rows.push(row);
  }
  for (const book of readingData.books) {
    const row = inspectionRecord('reading', 'reading', book as unknown as Record<string, unknown>, [
      { title: '作者', text: book.author || '未填写' },
      ...readingData.chapters.filter(chapter => chapter.bookId === book.id).sort((a, b) => a.index - b.index).map(chapter => ({ title: chapter.title || `第 ${chapter.index + 1} 章`, text: chapter.paragraphs.join('\n\n') })),
      { title: '阅读批注', text: inspectionText(readingData.annotations.filter(item => item.bookId === book.id)) },
    ]); if (row) rows.push(row);
    if(row?.preview){row.preview.data.chapters=readingData.chapters.filter(c=>c.bookId===book.id);row.preview.data.annotations=readingData.annotations.filter(a=>a.bookId===book.id);}
  }
  for(const row of rows)if(row.preview){
    const partial=row.preview.partial;
    try{const theme=JSON.parse(kvGet('ai_phone_theme_profile_v1')||'{}');row.preview.data.appearance={fontFamily:theme.fontFamily,fontAssetId:theme.fontAssetId,cssOverrides:theme.cssOverrides};}catch{/*Default appearance.*/}
    row.preview=createInspectionPreview(row.kind,row.preview.data);row.preview.partial ||= partial;
    if(['app','game'].includes(row.preview.type)&&!(Array.isArray(row.preview.data.scenes)&&row.preview.data.scenes.length))row.preview.partial=true;
  }
  return rows;
}
async function deliver() {
  if (busy || !isKvHydrated() || !navigator.onLine) return;
  busy = true;
  try {
    const rows = await collect(), changed: { row: PhoneInspectionRecord; hash: string }[] = [];
    const current = new Set(rows.map(identity));
    for (const [key, summary] of Object.entries(delivery.summaries)) {
      if (!current.has(key) && !summary.deleted && summary.kind !== 'diagnostic') rows.push({ ...summary, sections: [], deleted: true });
    }
    for (const row of rows) { const digest = await hash(row); if (delivery.hashes[identity(row)] !== digest) changed.push({ row, hash: digest }); }
    // Pending content stays in the user's own local stores. Failed acknowledgements
    // never advance hashes, so reopening or coming online retries the latest content.
    for (let offset = 0; offset < changed.length;) {
      const chunk: typeof changed = []; let bytes = 0;
      while (offset < changed.length && chunk.length < 20) {
        const next = changed[offset], size = new TextEncoder().encode(JSON.stringify(next.row)).length;
        if (chunk.length && bytes + size > 2000000) break;
        chunk.push(next); bytes += size; offset++;
      }
      delivery.revision = Math.max(Date.now(), delivery.revision + 1);
      kvSet(stateKey, JSON.stringify(delivery));
      const records:PhoneInspectionRecord[]=[],pendingAssets=new Set<string>();
      for(const item of chunk){
        const row={...item.row};
        if(row.preview)row.preview=await prepareInspectionPreview(row.preview,async(id,blob,info)=>{
          if(deliveredAssets.has(id))return;
          const h=yelanHeaders();delete h['Content-Type'];
          try{
            const assetResponse=await fetch(`/api/host/phone/inspection/assets/${id}`,{method:'POST',headers:{...h,'Content-Type':blob.type,...(info?.source?{'X-Yelan-Asset-Source':info.source}:{}),...(info?.name?{'X-Yelan-Asset-Name':encodeURIComponent(info.name)}:{})},body:blob,signal:AbortSignal.timeout(30000)});
            if(!assetResponse.ok)throw new Error('ASSET_UPLOAD_FAILED');deliveredAssets.add(id);
          }catch(error){pendingAssets.add(identity(row));throw error;}
        },async(url)=>{
          if(!remoteAssets.has(url)){
            if(remoteAssets.size>=500)remoteAssets.delete(remoteAssets.keys().next().value!);
            remoteAssets.set(url,(async()=>{
              try{
                const response=await fetch('/api/host/phone/inspection/remote-image',{method:'POST',headers:yelanHeaders(),body:JSON.stringify({url}),signal:AbortSignal.timeout(35000)});
                if(!response.ok)throw new Error(response.status===429||response.status>=500?'REMOTE_IMAGE_UNAVAILABLE':'REMOTE_IMAGE_PERMANENT');
                return await response.json() as {id:string;mime:string};
              }catch(error){if(!(error instanceof Error)||error.message!=='REMOTE_IMAGE_PERMANENT')pendingAssets.add(identity(row));remoteAssets.delete(url);throw error;}
            })());
          }
          return remoteAssets.get(url)!;
        });
        records.push(row);
      }
      const response = await fetch('/api/host/phone/inspection', { method: 'POST', headers: yelanHeaders(),
        body: JSON.stringify({ ownerUserId, deviceId: delivery.deviceId, revision: delivery.revision, records }),
        signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error('INSPECTION_UNAVAILABLE');
      for (let i=0;i<chunk.length;i++) { const item=chunk[i]!; const summary={...item.row} as Partial<PhoneInspectionRecord>; delete summary.sections;delete summary.preview;
        // Permanent missing/oversized local files must not resubmit the whole work
        // every 30 seconds; transport failures still retry on the next delivery.
        if(!pendingAssets.has(identity(item.row)))delivery.hashes[identity(item.row)] = item.hash;
        delivery.summaries[identity(item.row)] = summary as Omit<PhoneInspectionRecord,'sections'>;
      }
      kvSet(stateKey, JSON.stringify(delivery));
    }
  } catch { /* Operational evidence must never block editing or generation. */ }
  finally { busy = false; }
}
export function startPhoneInspection(userId: string) {
  if (!isYelanManaged || !userId || typeof window === 'undefined') return;
  if (started) { if (ownerUserId === userId) window.dispatchEvent(new CustomEvent('yelan-inspection-changed')); return; }
  started = true; ownerUserId = userId;
  try { delivery = JSON.parse(kvGet(stateKey) || 'null'); } catch { /* fresh store */ }
  if (!delivery?.deviceId || !delivery.hashes) delivery = { deviceId: crypto.randomUUID(), revision: 0, hashes: {}, summaries: {} };
  if (!Number.isSafeInteger(delivery.revision) || delivery.revision < 0) delivery.revision = 0;
  delivery.summaries ??= {};
  // Revisit old snapshots once while retaining the same device identity.
  if(delivery.formatVersion!==2){delivery.hashes={};delivery.formatVersion=2;}
  kvSet(stateKey, JSON.stringify(delivery));
  const schedule = () => { clearTimeout(wakeup); wakeup = setTimeout(() => void deliver(), 1500); };
  window.addEventListener('yelan-inspection-changed', schedule);
  window.addEventListener('online', () => void deliver());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void deliver(); });
  setInterval(() => void deliver(), 30000);
  void deliver();
}
