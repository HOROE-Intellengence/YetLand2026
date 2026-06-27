export interface UserRecord {
  id: string;
  phone: string;
  name?: string;
  ageVerified: boolean;
  narrativeBoundary: 1 | 2 | 3 | 4 | 5;
  ifUnlocked: boolean;
  createdAt: string;
  // 账户档案扩展（feat/user-account, Phase 1）
  email?: string;
  nickname?: string;
  avatarUrl?: string;
  bio?: string;
  hasPassword?: boolean;
  passwordUpdatedAt?: string;
  phoneVerifiedAt?: string;
  deletedAt?: string;
}

export interface SessionRecord {
  id: string;
  userId: string;
  characterId: string;
  mode: 'main' | 'if';
  round: number;
  prevStage: 'daily' | 'rise' | 'climax' | 'after' | 'end';
  createdAt: string;
  updatedAt: string;
}

export interface MessageRecord {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface QuotaRecord {
  date: string;
  freeLimit: number;
  freeUsed: number;
  bonusLimit: number;
  bonusUsed: number;
}

export interface CostRecord {
  date: string;
  cost: number;
  tokens: number;
  calls: number;
}

export interface UserRepository {
  findByToken(token: string): Promise<UserRecord | null>;
  findByPhone(phone: string): Promise<UserRecord | null>;
  create(phone: string): Promise<UserRecord>;
  updateName(userId: string, name: string): Promise<UserRecord | null>;
}

export interface SessionRepository {
  findOrCreate(id: string, userId: string, characterId: string): Promise<SessionRecord>;
  getMessages(sessionId: string): Promise<MessageRecord[]>;
  appendMessage(sessionId: string, role: 'user' | 'assistant', content: string): Promise<MessageRecord>;
}

export interface QuotaRepository {
  getToday(userId: string): Promise<QuotaRecord>;
  consumeOne(userId: string): Promise<boolean>;
}

export interface CostRepository {
  recordTurn(data: { date: string; cost: number; tokens: number }): void;
  getDailyCosts(): Promise<CostRecord[]>;
}

export interface CharacterRepository {
  get(id: string): Promise<{ id: string; name: string; description: string; styleTags: string[]; isActive: boolean } | null>;
  listActive(): Promise<Array<{ id: string; name: string }>>;
}
