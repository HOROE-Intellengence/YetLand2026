export interface MemoryScope {
  mode: 'main' | 'if';
  branchId?: string;
  sourceApp?: string;
}

export function memoryScopeKey(userId: string, characterId: string, scope: MemoryScope): string {
  return JSON.stringify([userId, characterId, scope.mode, scope.branchId ?? '']);
}

export function pinnedUserIdentity(markdown: string | undefined): string {
  return (markdown ?? '').split('\n').filter(line =>
    line.trim().startsWith('- 用户称呼名：') || line.trim().startsWith('- User display name:'),
  ).join('\n');
}
