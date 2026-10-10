import { isYelanManaged, yelanRequest } from './yelan-managed-client';
import { loadCharacters } from './character-storage';
import { loadNativeTimeline, filterTimelineByAllowedSources } from './short-term-assembler';
import { kvGet, kvSet } from './kv-db';
import { memoryParts } from './yelan-memory-parts';
import { loadDwellingLayout } from './dwelling-storage';
import { dwellingMemoryEntry } from './yelan-dwelling-memory';
import { loadMemoryConfig } from './memory-storage';

let busy = false;
export async function flushYelanMemory(automatic = false) {
  if (!isYelanManaged || busy) return;
  const config = loadMemoryConfig();
  if (automatic && !config.autoSummarizeEnabled) return;
  busy = true;
  try {
    for (const character of loadCharacters()) {
      const key = `yelan-memory-ack:${character.id}`;
      const ack = new Set<string>(JSON.parse(kvGet(key) || '[]'));
      const dwelling = dwellingMemoryEntry(character.id, await loadDwellingLayout(character.id));
      const pending = [...filterTimelineByAllowedSources(loadNativeTimeline(character.id), config.shortTermAllowedSources), ...(dwelling ? [dwelling] : [])];
      let remaining = 10;
      for (const entry of pending) {
        const narrative = ['story', 'vn', 'map', 'game'].includes(entry.sourceApp);
        const branchId = narrative ? `${entry.sourceApp}:${entry.sessionId || entry.id}` : '';
        const revisionHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([
          entry.id, entry.sourceApp, branchId, entry.timestamp, entry.content,
        ])));
        const revision = `entry:v2:${Array.from(new Uint8Array(revisionHash), byte => byte.toString(16).padStart(2, '0')).join('')}`;
        if (ack.has(revision)) continue;
        if (remaining <= 0) break;
        const parts = memoryParts(entry);
        let complete = true;
        for (let index = 0; index < parts.length; index++) {
          const text = parts[index];
          const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([character.id, entry.sourceApp, branchId, entry.id, index, text])));
          const eventId = `phone:${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')}`;
          if (ack.has(eventId)) continue;
          if (remaining-- <= 0) { complete = false; break; }
          try {
            await yelanRequest('/phone/memory/events', { method: 'POST', body: JSON.stringify({
              eventId, characterId: character.id, sourceApp: entry.sourceApp === 'map' ? 'adventure' : entry.sourceApp,
              mode: 'main', ...(branchId ? { branchId } : {}), text,
            }) });
            ack.add(eventId);
            kvSet(key, JSON.stringify(Array.from(ack)));
          } catch {
            // One failed upload must not starve other roles or sources.
            complete = false; break;
          }
        }
        if (complete) ack.add(revision);
        kvSet(key, JSON.stringify(Array.from(ack)));
      }
    }
  } finally { busy = false; }
}

export function startYelanMemoryBridge() {
  if (!isYelanManaged) return () => {};
  const timer = window.setInterval(() => {
    void flushYelanMemory(true).catch(() => { /* Keep unacknowledged entries for a later retry. */ });
  }, 30000);
  return () => window.clearInterval(timer);
}
