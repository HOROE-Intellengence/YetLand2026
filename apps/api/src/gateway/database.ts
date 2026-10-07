import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ApiKeyNameSchema } from '@yelan/shared';
import type {
  ApiGatewaySettings,
  ApiKeyView,
  ApiPreludeView,
  ApiTier,
  ApiCallView,
  ApiOverview,
  ApiQuota,
} from '@yelan/shared';

export class GatewayError extends Error {
  constructor(
    public code: string,
    public status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 500 | 502 | 503 | 504,
    message: string,
  ) {
    super(message);
  }
}
export type Identity = {
  id: string;
  name?: string;
  phone?: string;
  email?: string;
  createdAt: string;
  isGuest?: boolean;
  deletedAt?: string;
  registration?: { name?: string; phone?: string; email?: string; registeredAt: string } | null;
};
export interface KeyRow extends Omit<ApiKeyView, 'todayCalls' | 'totalCalls'> {
  hash: string;
  identity: string;
  verificationId: string | null;
}
export interface CallRow extends Omit<ApiCallView, 'keyPrefix'> {
  identity: string;
  request: string;
  upstreamRequest: string;
  upstreamId: string;
  response: string | null;
  outputText: string;
  stream: number;
  trainingConsent: number;
  updatedAt: string;
  usage: string | null;
}
export interface CallFilter {
  from: string;
  to: string;
  tier?: ApiTier;
  userId?: string;
  keyId?: string;
}
export const DEFAULT_SETTINGS: ApiGatewaySettings = {
  enabled: true,
  upstreamId: 'horoe-gemini-flash-lite',
  accountDailyLimit: 200,
  accountRpm: 30,
  accountConcurrency: 3,
  timeoutSeconds: 180,
};
export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');
export const dayStart = () => new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z';
const now = () => new Date().toISOString();
export function normalizeVerifiedPhone(phone: string): string {
  const digits = phone.replace(/[\s-]/g, '').replace(/^(?:\+86|0086)/, '');
  if (!/^1[3-9]\d{9}$/.test(digits))
    throw new GatewayError('INVALID_PHONE', 400, '请输入有效的中国大陆手机号');
  return `+86${digits}`;
}
type KeyInput = {
  name: string;
  tier: ApiTier;
  dailyLimit: number;
  rpm: number;
  concurrency: number;
  expiresAt?: string;
};

export class GatewayDatabase {
  readonly db: Database.Database;
  constructor(root: string, initialPrelude: string) {
    mkdirSync(root, { recursive: true });
    this.db = new Database(join(root, 'api.sqlite'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = FULL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS phone_verifications (id TEXT PRIMARY KEY, userId TEXT NOT NULL, phone TEXT NOT NULL, purpose TEXT NOT NULL, verifiedAt TEXT NOT NULL, consumedAt TEXT);
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY, userId TEXT NOT NULL, name TEXT NOT NULL, prefix TEXT NOT NULL, hash TEXT NOT NULL UNIQUE,
        tier TEXT NOT NULL CHECK(tier IN ('pure','advanced')), status TEXT NOT NULL, verification TEXT NOT NULL,
        verifiedPhone TEXT, verificationId TEXT REFERENCES phone_verifications(id), identity TEXT NOT NULL,
        createdAt TEXT NOT NULL, expiresAt TEXT, lastUsedAt TEXT, dailyLimit INTEGER NOT NULL, rpm INTEGER NOT NULL, concurrency INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS keys_user ON api_keys(userId);
      CREATE UNIQUE INDEX IF NOT EXISTS keys_verified_phone_unique
        ON api_keys(verifiedPhone) WHERE verifiedPhone IS NOT NULL AND status!='revoked';
      CREATE TABLE IF NOT EXISTS prelude_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL, hash TEXT NOT NULL, createdAt TEXT NOT NULL, source TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS prelude (id INTEGER PRIMARY KEY CHECK(id=1), draft TEXT NOT NULL, revision INTEGER NOT NULL, publishedId INTEGER REFERENCES prelude_versions(id));
      CREATE TABLE IF NOT EXISTS calls (
        id TEXT PRIMARY KEY, userId TEXT NOT NULL, keyId TEXT NOT NULL REFERENCES api_keys(id), tier TEXT NOT NULL,
        identity TEXT NOT NULL, request TEXT NOT NULL, upstreamRequest TEXT NOT NULL, upstreamId TEXT NOT NULL,
        model TEXT NOT NULL, promptVersion INTEGER REFERENCES prelude_versions(id), stream INTEGER NOT NULL,
        status TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, durationMs INTEGER,
        httpStatus INTEGER, errorCode TEXT, inputTokens INTEGER, outputTokens INTEGER, usage TEXT,
        response TEXT, outputText TEXT NOT NULL DEFAULT '', trainingConsent INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS calls_time ON calls(createdAt);
      CREATE INDEX IF NOT EXISTS calls_key ON calls(keyId, createdAt);
      CREATE INDEX IF NOT EXISTS calls_user ON calls(userId, createdAt);
      CREATE TABLE IF NOT EXISTS response_chunks (callId TEXT NOT NULL REFERENCES calls(id), seq INTEGER NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY(callId,seq));
      CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, action TEXT NOT NULL, target TEXT, createdAt TEXT NOT NULL);
    `);
    this.db
      .prepare('INSERT OR IGNORE INTO settings VALUES (1,?)')
      .run(JSON.stringify(DEFAULT_SETTINGS));
    this.db.prepare('INSERT OR IGNORE INTO prelude VALUES (1,?,0,NULL)').run(initialPrelude);
  }
  recover() {
    this.db
      .prepare(
        "UPDATE calls SET status='interrupted', errorCode='PROCESS_RESTARTED', updatedAt=? WHERE status='processing'",
      )
      .run(now());
  }
  audit(action: string, target?: string) {
    this.db
      .prepare('INSERT INTO audit(action,target,createdAt) VALUES (?,?,?)')
      .run(action, target ?? null, now());
  }
  settings(): ApiGatewaySettings {
    return JSON.parse(
      (this.db.prepare('SELECT json FROM settings WHERE id=1').get() as { json: string }).json,
    );
  }
  setSettings(value: ApiGatewaySettings) {
    this.db.transaction(() => {
      this.db.prepare('UPDATE settings SET json=? WHERE id=1').run(JSON.stringify(value));
      this.audit('settings.update');
    })();
  }
  prelude(): ApiPreludeView {
    const row = this.db
      .prepare('SELECT draft,revision,publishedId FROM prelude WHERE id=1')
      .get() as Omit<ApiPreludeView, 'versions'>;
    return {
      ...row,
      versions: this.db
        .prepare('SELECT * FROM prelude_versions ORDER BY id DESC')
        .all() as ApiPreludeView['versions'],
    };
  }
  saveDraft(content: string, revision: number) {
    this.db.transaction(() => {
      const r = this.db
        .prepare('UPDATE prelude SET draft=?,revision=revision+1 WHERE id=1 AND revision=?')
        .run(content, revision);
      if (!r.changes)
        throw new GatewayError('DRAFT_CONFLICT', 409, '草稿已被其他管理员修改，请刷新');
      this.audit('prelude.draft');
    })();
  }
  publish(revision: number, rollbackId?: number) {
    this.db.transaction(() => {
      const p = this.prelude();
      if (p.revision !== revision)
        throw new GatewayError('DRAFT_CONFLICT', 409, '版本已变化，请刷新');
      const content = rollbackId ? p.versions.find((v) => v.id === rollbackId)?.content : p.draft;
      if (!content?.trim()) throw new GatewayError('PRELUDE_EMPTY', 400, '请选择有效的前置内容');
      const id = this.db
        .prepare('INSERT INTO prelude_versions(content,hash,createdAt,source) VALUES (?,?,?,?)')
        .run(
          content,
          hashKey(content),
          now(),
          rollbackId ? `rollback:${rollbackId}` : 'publish',
        ).lastInsertRowid;
      this.db.prepare('UPDATE prelude SET publishedId=?,revision=revision+1 WHERE id=1').run(id);
      this.audit(rollbackId ? 'prelude.rollback' : 'prelude.publish', String(id));
    })();
  }
  published(): { id: number; content: string } | undefined {
    return this.db
      .prepare(
        'SELECT v.id,v.content FROM prelude_versions v JOIN prelude p ON p.publishedId=v.id WHERE p.id=1',
      )
      .get() as { id: number; content: string } | undefined;
  }
  createTestKey(user: Identity, input: KeyInput) {
    return this.createKey(user, input);
  }
  // Only a server-persisted, successful SMS verification may reach this path.
  // Public SMS/application endpoints remain disabled until the provider is wired.
  createVerifiedKey(user: Identity, input: KeyInput, verificationId: string) {
    if (!verificationId)
      throw new GatewayError('PHONE_VERIFICATION_REQUIRED', 400, '请先验证手机号');
    return this.createKey(user, input, verificationId);
  }
  private createKey(user: Identity, input: KeyInput, verificationId?: string) {
    const parsedName = ApiKeyNameSchema.safeParse(input.name);
    if (!parsedName.success)
      throw new GatewayError('INVALID_KEY_NAME', 400, 'Key 名称需为 1–80 个字符，不能仅为空格');
    if (user.isGuest || user.deletedAt)
      throw new GatewayError('REGISTERED_ACCOUNT_REQUIRED', 403, '请先登录注册账号');
    return this.db
      .transaction(() => {
        let verifiedPhone: string | null = null;
        if (verificationId) {
          const proof = this.db
            .prepare('SELECT * FROM phone_verifications WHERE id=?')
            .get(verificationId) as
            | {
                userId: string;
                phone: string;
                purpose: string;
                verifiedAt: string;
                consumedAt: string | null;
              }
            | undefined;
          const age = proof ? Date.now() - Date.parse(proof.verifiedAt) : NaN;
          if (
            !proof ||
            proof.userId !== user.id ||
            proof.purpose !== 'api_key' ||
            proof.consumedAt ||
            !Number.isFinite(age) ||
            age < 0 ||
            age > 5 * 60000
          )
            throw new GatewayError(
              'PHONE_VERIFICATION_REQUIRED',
              400,
              '手机号核验已失效，请重新验证',
            );
          verifiedPhone = normalizeVerifiedPhone(proof.phone);
          if (
            this.db
              .prepare("SELECT 1 FROM api_keys WHERE verifiedPhone=? AND status!='revoked'")
              .get(verifiedPhone)
          )
            throw new GatewayError(
              'PHONE_KEY_LIMIT',
              409,
              '该手机号已有 Key，请先撤销旧 Key；纯净版与高级版共用此名额',
            );
        }
        const count = this.db
          .prepare(
            "SELECT COUNT(*) n FROM api_keys WHERE userId=? AND status!='revoked' AND (expiresAt IS NULL OR expiresAt>?)",
          )
          .get(user.id, now()) as { n: number };
        if (!verificationId && count.n >= 2)
          throw new GatewayError('KEY_LIMIT', 409, '每个账号最多保留两个未撤销且未过期的 Key');
        const secret = `yl_${randomBytes(32).toString('base64url')}`;
        const key: KeyRow = {
          id: randomUUID(),
          userId: user.id,
          name: parsedName.data,
          prefix: secret.slice(0, 10),
          hash: hashKey(secret),
          tier: input.tier,
          status: 'active',
          verification: verificationId ? 'sms' : 'admin_test',
          verifiedPhone,
          verificationId: verificationId ?? null,
          identity: JSON.stringify({ ...user, snapshotSource: 'key_application' }),
          createdAt: now(),
          expiresAt: input.expiresAt ?? null,
          lastUsedAt: null,
          dailyLimit: input.dailyLimit,
          rpm: input.rpm,
          concurrency: input.concurrency,
        };
        this.db
          .prepare(
            'INSERT INTO api_keys VALUES (@id,@userId,@name,@prefix,@hash,@tier,@status,@verification,@verifiedPhone,@verificationId,@identity,@createdAt,@expiresAt,@lastUsedAt,@dailyLimit,@rpm,@concurrency)',
          )
          .run(key);
        if (verificationId)
          this.db
            .prepare('UPDATE phone_verifications SET consumedAt=? WHERE id=?')
            .run(now(), verificationId);
        this.audit(verificationId ? 'key.create.sms' : 'key.create.admin_test', key.id);
        return { secret, key: this.keyView(key.id)! };
      })
      .immediate();
  }
  keyBySecret(secret: string) {
    return this.db.prepare('SELECT * FROM api_keys WHERE hash=?').get(hashKey(secret)) as
      | KeyRow
      | undefined;
  }
  key(id: string) {
    return this.db.prepare('SELECT * FROM api_keys WHERE id=?').get(id) as KeyRow | undefined;
  }
  keys(userId?: string): ApiKeyView[] {
    return this.db
      .prepare(
        `SELECT k.id,k.userId,k.name,k.prefix,k.tier,k.status,k.verification,k.verifiedPhone,k.createdAt,k.expiresAt,k.lastUsedAt,k.dailyLimit,k.rpm,k.concurrency,
      (SELECT COUNT(*) FROM calls c WHERE c.keyId=k.id AND c.createdAt>=?) todayCalls,
      (SELECT COUNT(*) FROM calls c WHERE c.keyId=k.id) totalCalls FROM api_keys k ${userId ? 'WHERE k.userId=?' : ''} ORDER BY k.createdAt DESC`,
      )
      .all(dayStart(), ...(userId ? [userId] : [])) as ApiKeyView[];
  }
  quota(userId: string): ApiQuota {
    const start = dayStart();
    const { used } = this.db
      .prepare('SELECT COUNT(*) used FROM calls WHERE userId=? AND createdAt>=?')
      .get(userId, start) as { used: number };
    const total = this.settings().accountDailyLimit;
    return {
      unit: 'requests',
      period: 'day',
      timezone: 'UTC',
      total,
      used,
      remaining: Math.max(0, total - used),
      resetsAt: new Date(Date.parse(start) + 86400000).toISOString(),
    };
  }
  keyView(id: string) {
    const k = this.key(id);
    return k ? this.keys(k.userId).find((x) => x.id === id) : undefined;
  }
  patchKey(
    id: string,
    patch: Partial<Pick<KeyRow, 'status' | 'name' | 'dailyLimit' | 'rpm' | 'concurrency'>>,
  ) {
    this.db.transaction(() => {
      const row = this.key(id);
      if (!row) throw new GatewayError('KEY_NOT_FOUND', 404, 'Key 不存在');
      if (row.status === 'revoked')
        throw new GatewayError('KEY_REVOKED', 409, '已撤销 Key 不能恢复');
      const next = { ...row, ...patch };
      this.db
        .prepare(
          'UPDATE api_keys SET status=@status,name=@name,dailyLimit=@dailyLimit,rpm=@rpm,concurrency=@concurrency WHERE id=@id',
        )
        .run(next);
      this.audit('key.update', id);
    })();
  }
  begin(
    key: KeyRow,
    input: {
      id: string;
      request: string;
      upstreamRequest: string;
      upstreamId: string;
      model: string;
      promptVersion: number | null;
      stream: boolean;
    },
  ) {
    this.db.transaction(() => {
      const settings = this.settings();
      const minute = new Date(Date.now() - 60000).toISOString();
      for (const [column, id, daily, rpm, concurrent] of [
        ['keyId', key.id, key.dailyLimit, key.rpm, key.concurrency],
        [
          'userId',
          key.userId,
          settings.accountDailyLimit,
          settings.accountRpm,
          settings.accountConcurrency,
        ],
      ] as const) {
        const counts = this.db
          .prepare(
            `SELECT SUM(createdAt>=?) daily, SUM(createdAt>=?) minute, SUM(status='processing') active FROM calls WHERE ${column}=? AND (createdAt>=? OR status='processing')`,
          )
          .get(dayStart(), minute, id, dayStart()) as {
          daily: number;
          minute: number;
          active: number;
        };
        if (counts.daily >= daily || counts.minute >= rpm || counts.active >= concurrent)
          throw new GatewayError('RATE_LIMITED', 429, '已达到账号或 Key 的调用额度／并发上限');
      }
      const createdAt = now();
      this.db
        .prepare(
          `INSERT INTO calls(id,userId,keyId,tier,identity,request,upstreamRequest,upstreamId,model,promptVersion,stream,status,createdAt,updatedAt)
        VALUES (@id,@userId,@keyId,@tier,@identity,@request,@upstreamRequest,@upstreamId,@model,@promptVersion,@stream,'processing',@createdAt,@createdAt)`,
        )
        .run({
          ...input,
          stream: Number(input.stream),
          userId: key.userId,
          keyId: key.id,
          tier: key.tier,
          identity: key.identity,
          createdAt,
        });
      this.db.prepare('UPDATE api_keys SET lastUsedAt=? WHERE id=?').run(createdAt, key.id);
    })();
  }
  chunk(id: string, seq: number, bytes: Uint8Array) {
    this.db.prepare('INSERT INTO response_chunks VALUES (?,?,?)').run(id, seq, Buffer.from(bytes));
  }
  finish(
    id: string,
    values: {
      status: string;
      httpStatus: number;
      durationMs: number;
      errorCode?: string;
      outputText?: string;
      response?: string;
      usage?: Record<string, unknown>;
    },
  ) {
    const token = (v: unknown) =>
      typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
    this.db
      .prepare(
        `UPDATE calls SET status=@status,httpStatus=@httpStatus,durationMs=@durationMs,errorCode=@errorCode,outputText=@outputText,response=@response,usage=@usage,inputTokens=@inputTokens,outputTokens=@outputTokens,updatedAt=@updatedAt WHERE id=@id`,
      )
      .run({
        id,
        ...values,
        errorCode: values.errorCode ?? null,
        outputText: values.outputText ?? '',
        response: values.response ?? null,
        usage: values.usage ? JSON.stringify(values.usage) : null,
        inputTokens: token(values.usage?.prompt_tokens),
        outputTokens: token(values.usage?.completion_tokens),
        updatedAt: now(),
      });
  }
  call(id: string) {
    return this.db.prepare('SELECT * FROM calls WHERE id=?').get(id) as CallRow | undefined;
  }
  rawResponse(id: string): string {
    return Buffer.concat(
      (
        this.db
          .prepare('SELECT bytes FROM response_chunks WHERE callId=? ORDER BY seq')
          .all(id) as { bytes: Buffer }[]
      ).map((x) => x.bytes),
    ).toString('utf8');
  }
  filter(f: CallFilter) {
    return {
      sql: `c.createdAt>=? AND c.createdAt<=?${f.tier ? ' AND c.tier=?' : ''}${f.userId ? ' AND c.userId=?' : ''}${f.keyId ? ' AND c.keyId=?' : ''}`,
      args: [
        f.from,
        f.to,
        ...(f.tier ? [f.tier] : []),
        ...(f.userId ? [f.userId] : []),
        ...(f.keyId ? [f.keyId] : []),
      ],
    };
  }
  calls(f: CallFilter, offset = 0, limit = 50) {
    const { sql, args } = this.filter(f);
    const total = (
      this.db.prepare(`SELECT COUNT(*) n FROM calls c WHERE ${sql}`).get(...args) as { n: number }
    ).n;
    const rows = this.db
      .prepare(
        `SELECT c.id,c.userId,c.keyId,k.prefix keyPrefix,c.tier,c.model,c.promptVersion,c.status,c.createdAt,c.durationMs,c.httpStatus,c.errorCode,c.inputTokens,c.outputTokens FROM calls c JOIN api_keys k ON k.id=c.keyId WHERE ${sql} ORDER BY c.createdAt DESC LIMIT ? OFFSET ?`,
      )
      .all(...args, limit, offset) as ApiCallView[];
    return { total, rows };
  }
  overview(f: CallFilter): ApiOverview {
    const { sql, args } = this.filter(f);
    const stats = this.db
      .prepare(
        `SELECT COUNT(*) total, COALESCE(SUM(status='succeeded'),0) succeeded, COALESCE(SUM(status IN ('failed','interrupted')),0) failed, AVG(CASE WHEN status!='processing' THEN durationMs END) averageMs,COALESCE(SUM(inputTokens),0) inputTokens,COALESCE(SUM(outputTokens),0) outputTokens,COALESCE(SUM(status='succeeded' AND usage IS NULL),0) usageMissing FROM calls c WHERE ${sql}`,
      )
      .get(...args) as Omit<ApiOverview, 'active' | 'days' | 'errors'>;
    const active = (
      this.db
        .prepare(
          `SELECT COUNT(*) n FROM calls WHERE status='processing'${f.tier ? ' AND tier=?' : ''}${f.keyId ? ' AND keyId=?' : ''}${f.userId ? ' AND userId=?' : ''}`,
        )
        .get(
          ...(f.tier ? [f.tier] : []),
          ...(f.keyId ? [f.keyId] : []),
          ...(f.userId ? [f.userId] : []),
        ) as { n: number }
    ).n;
    const days = this.db
      .prepare(
        `SELECT substr(createdAt,1,10) day,COUNT(*) total,SUM(status='succeeded') succeeded FROM calls c WHERE ${sql} GROUP BY day ORDER BY day`,
      )
      .all(...args) as ApiOverview['days'];
    const errors = this.db
      .prepare(
        `SELECT errorCode,COUNT(*) count FROM calls c WHERE ${sql} AND errorCode IS NOT NULL GROUP BY errorCode ORDER BY count DESC LIMIT 10`,
      )
      .all(...args) as ApiOverview['errors'];
    return { ...stats, active, days, errors };
  }
  close() {
    this.db.close();
  }
}

export function gatewayRoot() {
  const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const override = process.env.API_GATEWAY_DATA_DIR?.trim();
  if (override) return resolve(override);
  return join(
    process.env.YELAN_STATE_DIR?.trim() ||
      join(
        apiRoot,
        process.env.VITEST || process.env.NODE_ENV === 'test' ? '.local-test' : '.local',
      ),
    'gateway',
  );
}
