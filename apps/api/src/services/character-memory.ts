import { store } from '../store/persistence';
import { getUserProfile } from '../sidecar-ai/preference-recorder';
import type { MemoryScope } from './memory-scope';

// Callers authorize character access first. All features read the same scoped
// facts, including newly extracted facts that have no embedding yet.
export function readCharacterMemory(userId: string, characterId: string, scope: MemoryScope): string {
  const s = store.state();
  const rows = [...Object.values(s.userPreferences), ...Object.values(s.userEvents)]
    .filter(row => row.userId === userId && row.characterId === characterId &&
      row.mode === scope.mode && row.branchId === scope.branchId && !row.tombstone)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 12);
  return [getUserProfile(userId, characterId, scope), ...rows.map(row => `- ${row.text}`)]
    .filter(Boolean).join('\n').slice(0, 6000);
}
