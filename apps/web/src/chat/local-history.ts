import { DEFAULT_USER_BOUNDARY, type Boundary, type ChatMessage, type Stage, type StructuredMessagePart } from '@yelan/shared';

const VERSION = 2;
const KEY_PREFIX = 'yelan.chatSession.';

export interface LocalChatSnapshot {
  version: typeof VERSION;
  characterId: string;
  ownerUserId: string;
  sessionId: string;
  messages: ChatMessage[];
  structuredParts: Record<string, StructuredMessagePart[]>;
  round: number;
  stage: Stage;
  boundary: Boundary;
  temperature: number;
  updatedAt: string;
}

export function createLocalSessionId(characterId: string): string {
  const suffix =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 12)
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `local_${characterId}_${suffix}`;
}

export function loadLocalChat(characterId: string, userId: string): LocalChatSnapshot | null {
  try {
    const raw = localStorage.getItem(storageKey(characterId, userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalChatSnapshot>;
    if (parsed.version !== VERSION || parsed.characterId !== characterId || !parsed.sessionId) {
      return null;
    }
    if (parsed.ownerUserId !== userId) {
      return null;
    }
    return {
      version: VERSION,
      characterId,
      ownerUserId: userId,
      sessionId: parsed.sessionId,
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      structuredParts: isRecord(parsed.structuredParts) ? parsed.structuredParts : {},
      round: Number.isInteger(parsed.round) ? parsed.round! : 0,
      stage: isStage(parsed.stage) ? parsed.stage : 'daily',
      boundary: isBoundary(parsed.boundary) ? parsed.boundary : DEFAULT_USER_BOUNDARY,
      temperature: isTemperature(parsed.temperature) ? parsed.temperature : 3,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function saveLocalChat(snapshot: LocalChatSnapshot): void {
  try {
    localStorage.setItem(storageKey(snapshot.characterId, snapshot.ownerUserId), JSON.stringify(snapshot));
  } catch {
    /* local cache is best effort */
  }
}

export function clearLocalChat(characterId: string, userId?: string): void {
  try {
    if (userId) {
      localStorage.removeItem(storageKey(characterId, userId));
    } else {
      localStorage.removeItem(storageKey(characterId));
    }
  } catch {
    /* noop */
  }
}

/**
 * 把归属在 fromUserId 名下的所有本地对话快照迁到 toUserId。
 * 用于登录时把访客（设备 id）对话过户到真实账号，让登录前的对话不丢。
 * 目标 key 已存在则跳过（不覆盖账号自己的对话）；迁移成功后删除源 key。
 * 返回迁移的快照条数。
 */
export function migrateLocalChatOwner(fromUserId: string, toUserId: string): number {
  if (!fromUserId || !toUserId || fromUserId === toUserId) return 0;
  let migrated = 0;
  try {
    const srcPrefix = `${KEY_PREFIX}${fromUserId}.`;
    const sourceKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(srcPrefix)) sourceKeys.push(key);
    }
    for (const srcKey of sourceKeys) {
      const characterId = srcKey.slice(srcPrefix.length);
      const destKey = storageKey(characterId, toUserId);
      const raw = localStorage.getItem(srcKey);
      // 目标已有对话则保留目标、丢弃源；否则改写 ownerUserId 后过户。
      if (raw && !localStorage.getItem(destKey)) {
        try {
          const parsed = JSON.parse(raw) as Partial<LocalChatSnapshot>;
          parsed.ownerUserId = toUserId;
          localStorage.setItem(destKey, JSON.stringify(parsed));
          migrated += 1;
        } catch {
          /* 源快照损坏，跳过迁移，照常删除 */
        }
      }
      localStorage.removeItem(srcKey);
    }
  } catch {
    /* local cache is best effort */
  }
  return migrated;
}

function storageKey(characterId: string, userId?: string): string {
  if (userId) return `${KEY_PREFIX}${userId}.${characterId}`;
  return `${KEY_PREFIX}${characterId}`;
}

function isRecord(value: unknown): value is Record<string, StructuredMessagePart[]> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isStage(value: unknown): value is Stage {
  return value === 'daily' || value === 'rise' || value === 'climax' || value === 'after' || value === 'end';
}

function isBoundary(value: unknown): value is Boundary {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

function isTemperature(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 5;
}
