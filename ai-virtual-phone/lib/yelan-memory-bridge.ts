import { isYelanManaged, yelanRequest } from './yelan-managed-client';
import { loadCharacters } from './character-storage';
import { loadNativeTimeline, type NativeTimelineEntry } from './short-term-assembler';
import { kvGet, kvSet } from './kv-db';

let busy = false;
export async function flushYelanMemory() {
  if (!isYelanManaged || busy) return;
  busy = true;
  try {
    for (const character of loadCharacters()) {
      const key = `yelan-memory-ack:${character.id}`;
      const ack = new Set<string>(JSON.parse(kvGet(key) || '[]'));
      const pending = loadNativeTimeline(character.id).filter(entry => !ack.has(entry.id));
      const groups = new Map<string, NativeTimelineEntry[]>();
      for (const entry of pending) {
        const narrative = ['story', 'vn', 'map', 'game'].includes(entry.sourceApp);
        const branch = narrative ? `${entry.sourceApp}:${entry.sessionId || entry.id}` : '';
        const groupKey = `${entry.sourceApp}\n${branch}`;
        const entries = groups.get(groupKey) || [];
        if (entries.length < 5 && entries.reduce((n, item) => n + item.content.length, 0) < 4000) entries.push(entry);
        groups.set(groupKey, entries);
      }
      for (const [groupKey, entries] of groups) {
        const [source, branchId] = groupKey.split('\n');
        const text = entries.map(entry => `[${entry.timestamp}] ${entry.content}`).join('\n').slice(0, 6000);
        if (!text.trim()) continue;
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([character.id, groupKey, entries.map(entry => entry.id), text])));
        const eventId = `phone:${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')}`;
        await yelanRequest('/phone/memory/events', { method: 'POST', body: JSON.stringify({
          eventId, characterId: character.id, sourceApp: source === 'map' ? 'adventure' : source,
          mode: 'main', ...(branchId ? { branchId } : {}), text,
        }) });
        entries.forEach(entry => ack.add(entry.id));
        kvSet(key, JSON.stringify(Array.from(ack)));
      }
    }
  } finally { busy = false; }
}

export function startYelanMemoryBridge() {
  if (!isYelanManaged) return () => {};
  const timer = window.setInterval(() => {
    void flushYelanMemory().catch(() => { /* Keep unacknowledged entries for a later retry. */ });
  }, 30000);
  return () => window.clearInterval(timer);
}
