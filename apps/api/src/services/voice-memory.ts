import { store } from '../store/persistence';
import { readCharacterMemory } from './character-memory';
import type { MemoryScope } from './memory-scope';

export function voiceMemoryScope(userId: string, characterId: string, sessionId: string, ifActive = false): MemoryScope {
  const phone = store.state().phoneVoiceSessions?.[sessionId];
  if (phone?.userId === userId && phone.characterId === characterId) {
    return { mode: ifActive ? 'if' : phone.mode, branchId: phone.branchId, sourceApp: 'voice' };
  }
  return { mode: ifActive ? 'if' : 'main', sourceApp: 'voice' };
}

export function voiceMemoryContext(userId: string, characterId: string, sessionId: string, scope: MemoryScope): string {
  const phone = store.state().phoneVoiceSessions?.[sessionId];
  const extra = phone?.userId === userId && phone.characterId === characterId && phone.mode === scope.mode ? phone.context : '';
  return [readCharacterMemory(userId, characterId, scope), extra].filter(Boolean).join('\n');
}
