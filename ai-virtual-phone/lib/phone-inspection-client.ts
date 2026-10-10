import type { PhoneInspectionRecord } from '../../packages/shared/src/contracts/phone';
import { kvEntries, kvGet, kvSet, isKvHydrated } from './kv-db';
import { isYelanManaged, yelanHeaders } from './yelan-managed-client';
import { inspectionRecord, inspectionText, kvInspectionRecords } from './phone-inspection-records';
const stateKey = 'yelan-inspection-delivery-v1';
type DeliveryState = { deviceId: string; revision: number; hashes: Record<string, string>; summaries: Record<string, Omit<PhoneInspectionRecord, 'sections'>> };
let started = false, busy = false, wakeup: ReturnType<typeof setTimeout> | undefined;
let ownerUserId = '', delivery: DeliveryState;
const identity = (row: PhoneInspectionRecord) => `${row.source}:${row.id}`;
const hash = async (row: PhoneInspectionRecord) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(row))))).map(value => value.toString(16).padStart(2, '0')).join('');

async function collect(): Promise<PhoneInspectionRecord[]> {
  const rows = kvEntries().flatMap(entry => kvInspectionRecords(entry.key, entry.value));
  const [story, vn, map, settings, reading] = await Promise.all([import('./story-storage'), import('./vn-storage'), import('./map-storage'), import('./settings-db'), import('./reading-storage')]);
  const [storyData, vnData, mapData, readingData] = await Promise.all([story.readStoryInspectionSnapshot(), vn.readVnInspectionSnapshot(), map.readMapInspectionSnapshot(), reading.readReadingInspectionSnapshot()]);
  for (const session of storyData.sessions) {
    const messages = storyData.messages.filter(message => message.sessionId === session.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const row = inspectionRecord('story', 'story', { ...session, title: session.title || '角色故事' }, [{ title: '故事正文', text: messages.map(message => `${message.role === 'user' ? '用户' : '角色'} · ${message.createdAt}\n${message.rawContent}`).join('\n\n') }]);
    if (row) rows.push(row);
  }
  for (const session of vnData.sessions) {
    const messages = vnData.messages.filter(message => message.sessionId === session.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const row = inspectionRecord('vn', 'vn', { ...session, title: session.chapters[0]?.title || '视觉小说' }, [
      { title: '章节', text: inspectionText(session.chapters) },
      { title: '剧情正文', text: messages.map(message => `第 ${message.chapterIndex + 1} 章 · ${message.role}\n${message.rawContent}`).join('\n\n') },
    ]);
    if (row) rows.push(row);
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
      const response = await fetch('/api/host/phone/inspection', { method: 'POST', headers: yelanHeaders(),
        body: JSON.stringify({ ownerUserId, deviceId: delivery.deviceId, revision: delivery.revision, records: chunk.map(item => item.row) }),
        signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error('INSPECTION_UNAVAILABLE');
      for (const item of chunk) { const { sections: _sections, ...summary } = item.row; delivery.hashes[identity(item.row)] = item.hash; delivery.summaries[identity(item.row)] = summary; }
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
  kvSet(stateKey, JSON.stringify(delivery));
  const schedule = () => { clearTimeout(wakeup); wakeup = setTimeout(() => void deliver(), 1500); };
  window.addEventListener('yelan-inspection-changed', schedule);
  window.addEventListener('online', () => void deliver());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void deliver(); });
  setInterval(() => void deliver(), 30000);
  void deliver();
}
