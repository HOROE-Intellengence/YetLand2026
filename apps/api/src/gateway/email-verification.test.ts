import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { BirdClient, type Verification } from '@messagebird/sdk';
import { GatewayDatabase, type Identity } from './database';
import {
  createBirdEmailProvider,
  configuredBirdEmailProvider,
  type BirdVerifyClient,
} from './email-verification';
import { createDeveloperRoute } from '../routes/developer';
import { store } from '../store/persistence';

describe('Bird email key verification', () => {
  let dir: string, db: GatewayDatabase;
  const user: Identity = { id: 'email-owner', createdAt: new Date().toISOString() };
  const keyInput = {
    name: '邮箱客户端',
    tier: 'pure' as const,
    dailyLimit: 100,
    rpm: 20,
    concurrency: 2,
  };
  let verification: Verification;
  let client: BirdVerifyClient;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'yl-email-'));
    db = new GatewayDatabase(dir, 'test');
    verification = {
      id: 'bird-verification',
      status: 'pending',
      to: { email: 'user@example.com' },
      channels: [{ channel: 'email' }],
      expires_at: new Date(Date.now() + 5 * 60000).toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    client = {
      create: vi.fn(async () => verification),
      check: vi.fn(async () => ({
        success: true,
        verification: { ...verification, status: 'verified' as const },
      })),
    };
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    db.db.close();
    const target = resolve(dir);
    if (!target.startsWith(resolve(tmpdir()) + '\\'))
      throw new Error('Unexpected test cleanup path');
    rmSync(target, { recursive: true, force: true });
  });
  const proof = (
    id: string,
    userId: string,
    email: string,
    date = new Date().toISOString(),
    purpose = 'api_key',
  ) =>
    db.db
      .prepare('INSERT INTO email_verifications VALUES (?,?,?,?,?,NULL)')
      .run(id, userId, email, purpose, date);

  it('uses the real SDK transport with normalized email, Chinese language and six digits', async () => {
    const requests: { url: string; body: Record<string, unknown> }[] = [];
    const bird = new BirdClient({
      apiKey: 'bk_us1_test',
      maxRetries: 0,
      fetch: (async (url, init) => {
        const request = new Request(url, init);
        requests.push({ url: request.url, body: JSON.parse(await request.text()) });
        return new Response(
          JSON.stringify(
            request.url.endsWith('/check')
              ? { success: true, verification: { ...verification, status: 'verified' } }
              : verification,
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }) as typeof fetch,
    });
    const provider = createBirdEmailProvider(() => db, bird.verify.verifications);
    const sent = await provider.send(user.id, ' User@Example.COM ');
    expect(sent.challengeId).not.toBe(verification.id);
    await expect(provider.verify(user.id, sent.challengeId, '123456')).resolves.toEqual({
      email: 'user@example.com',
    });
    expect(requests[0]!.url).toContain('/v1/verify/verifications');
    expect(requests[0]!.body).toEqual({
      to: { email: 'user@example.com' },
      options: { language: 'zh', code_length: 6 },
    });
    expect(requests[1]!.body).toEqual({ to: { email: 'user@example.com' }, code: '123456' });
    await expect(provider.verify(user.id, sent.challengeId, '123456')).rejects.toMatchObject({
      code: 'INVALID_CHALLENGE',
    });
    expect(requests).toHaveLength(2);
  });
  it('rejects invalid recipients, account crossover, expiry and forged challenges before contacting Bird', async () => {
    const provider = createBirdEmailProvider(() => db, client);
    await expect(provider.send(user.id, 'not-an-email')).rejects.toMatchObject({
      code: 'INVALID_EMAIL',
    });
    const sent = await provider.send(user.id, 'user@example.com');
    await expect(provider.verify('other', sent.challengeId, '123456')).rejects.toMatchObject({
      code: 'INVALID_CHALLENGE',
    });
    await expect(provider.verify(user.id, 'forged', '123456')).rejects.toMatchObject({
      code: 'INVALID_CHALLENGE',
    });
    db.db.prepare('UPDATE email_challenges SET expiresAt=0').run();
    await expect(provider.verify(user.id, sent.challengeId, '123456')).rejects.toMatchObject({
      code: 'INVALID_CHALLENGE',
    });
    expect(client.check).not.toHaveBeenCalled();
  });
  it('rejects Bird HTTP-200 incorrect codes and caps attempts at five', async () => {
    client.check = vi.fn(async () => ({ success: false, reason: 'incorrect_code', verification }));
    const provider = createBirdEmailProvider(() => db, client);
    const sent = await provider.send(user.id, 'user@example.com');
    for (let i = 0; i < 5; i++)
      await expect(provider.verify(user.id, sent.challengeId, '000000')).rejects.toMatchObject({
        code: 'INVALID_CODE',
      });
    await expect(provider.verify(user.id, sent.challengeId, '000000')).rejects.toMatchObject({
      code: 'INVALID_CHALLENGE',
    });
    expect(client.check).toHaveBeenCalledTimes(5);
  });
  it('requires Bird success to match both recipient and the persisted verification ID', async () => {
    const provider = createBirdEmailProvider(() => db, client);
    const sent = await provider.send(user.id, 'user@example.com');
    client.check = vi.fn(async () => ({
      success: true,
      verification: { ...verification, id: 'other', status: 'verified' as const },
    }));
    await expect(provider.verify(user.id, sent.challengeId, '123456')).rejects.toMatchObject({
      code: 'INVALID_CHALLENGE',
    });
  });
  it('reserves sends before awaits, rate limits user and recipient, and keeps challenges through restart', async () => {
    const provider = createBirdEmailProvider(() => db, client);
    const sent = await provider.send(user.id, 'user@example.com');
    await expect(provider.send(user.id, 'user@example.com')).rejects.toMatchObject({ status: 429 });
    await expect(provider.send('another-account', 'user@example.com')).rejects.toMatchObject({
      status: 429,
    });
    await expect(provider.send(user.id, 'another@example.com')).rejects.toMatchObject({
      status: 429,
    });
    db.db.close();
    db = new GatewayDatabase(dir, 'test');
    db.recover();
    const restarted = createBirdEmailProvider(() => db, client);
    await expect(restarted.verify(user.id, sent.challengeId, '123456')).resolves.toMatchObject({
      email: 'user@example.com',
    });
    expect(client.create).toHaveBeenCalledTimes(1);
  });
  it('rejects an old local challenge after resend even when Bird reuses its ID', async () => {
    vi.useFakeTimers();
    const provider = createBirdEmailProvider(() => db, client);
    const first = await provider.send(user.id, 'user@example.com');
    vi.advanceTimersByTime(61000);
    const second = await provider.send(user.id, 'user@example.com');
    await expect(provider.verify(user.id, first.challengeId, '123456')).rejects.toMatchObject({
      code: 'INVALID_CHALLENGE',
    });
    await expect(provider.verify(user.id, second.challengeId, '123456')).resolves.toMatchObject({
      email: 'user@example.com',
    });
  });
  it('does not expose provider credentials or report failed sends as sent', async () => {
    client.create = vi.fn(async () => {
      throw Object.assign(new Error('secret-key recipient-data'), { statusCode: 401 });
    });
    const provider = createBirdEmailProvider(() => db, client);
    await expect(provider.send(user.id, 'user@example.com')).rejects.toMatchObject({
      code: 'EMAIL_UNAVAILABLE',
      status: 503,
    });
    expect(db.db.prepare('SELECT consumedAt FROM email_challenges').get()).toMatchObject({
      consumedAt: expect.any(Number),
    });
    vi.stubEnv('BIRD_API_KEY', 'bk_xxxxxxxxx');
    expect(configuredBirdEmailProvider(() => db)).toBeUndefined();
  });
  it('atomically consumes email proof and enforces one non-revoked key across accounts and tiers', () => {
    proof('p1', user.id, 'USER@EXAMPLE.COM');
    const first = db.createVerifiedKey(user, keyInput, 'p1');
    expect(first.key).toMatchObject({
      verification: 'email',
      verifiedEmail: 'user@example.com',
      verifiedPhone: null,
    });
    expect(() => db.createVerifiedKey(user, keyInput, 'p1')).toThrow('核验');
    const other = { ...user, id: 'other' };
    proof('p2', other.id, 'user@example.com');
    db.patchKey(first.key.id, { status: 'disabled' });
    db.db
      .prepare('UPDATE api_keys SET expiresAt=? WHERE id=?')
      .run('2000-01-01T00:00:00Z', first.key.id);
    expect(() => db.createVerifiedKey(other, { ...keyInput, tier: 'advanced' }, 'p2')).toThrow(
      '已有 Key',
    );
    expect(
      db.db.prepare('SELECT consumedAt FROM email_verifications WHERE id=?').get('p2'),
    ).toEqual({ consumedAt: null });
    db.patchKey(first.key.id, { status: 'revoked' });
    expect(db.createVerifiedKey(other, keyInput, 'p2').key.verifiedEmail).toBe('user@example.com');
    const admin = db.createTestKey(user, keyInput);
    expect(() =>
      db.db
        .prepare('UPDATE api_keys SET verifiedEmail=? WHERE id=?')
        .run('user@example.com', admin.key.id),
    ).toThrow(/UNIQUE/);
  });
  it('rejects stale, cross-account, future and wrong-purpose email proofs', () => {
    for (const [id, owner, date, purpose] of [
      ['stale', user.id, new Date(Date.now() - 6 * 60000).toISOString(), 'api_key'],
      ['future', user.id, new Date(Date.now() + 60000).toISOString(), 'api_key'],
      ['wrong-owner', 'other', new Date().toISOString(), 'api_key'],
      ['wrong-purpose', user.id, new Date().toISOString(), 'login'],
    ]) {
      proof(id!, owner!, 'user@example.com', date!, purpose!);
      expect(() => db.createVerifiedKey(user, keyInput, id!)).toThrow('核验');
    }
    expect(db.keys()).toHaveLength(0);
  });
  it('migrates the old phone-only schema without losing keys', () => {
    const phoneUser = { ...user, id: 'phone-owner' };
    db.db
      .prepare('INSERT INTO phone_verifications VALUES (?,?,?,?,?,NULL)')
      .run('phone-proof', phoneUser.id, '13800000000', 'api_key', new Date().toISOString());
    const first = db.createVerifiedKey(phoneUser, keyInput, 'phone-proof');
    db.db.close();
    const legacy = new Database(join(dir, 'api.sqlite'));
    legacy.exec(
      'DROP INDEX keys_verified_email_unique; ALTER TABLE api_keys DROP COLUMN verifiedEmail; ALTER TABLE api_keys DROP COLUMN emailVerificationId;',
    );
    legacy.close();
    db = new GatewayDatabase(dir, 'test');
    expect(db.keyView(first.key.id)).toMatchObject({
      verifiedPhone: '+8613800000000',
      verifiedEmail: null,
    });
    proof('email-proof', user.id, 'user@example.com');
    expect(db.createVerifiedKey(user, keyInput, 'email-proof').key.verification).toBe('email');
    expect(db.keys()).toHaveLength(2);
  });
  it('runs the authenticated send → verify → key application path, retaining ownership and replay checks', async () => {
    store.__resetForTests();
    store.state().users[user.id] = {
      id: user.id,
      token: 'tok_email_owner',
      ageVerified: true,
      narrativeBoundary: 2,
      ifUnlocked: false,
      createdAt: user.createdAt,
      candle: 0,
      registerGrant: 0,
      conversationRounds: 0,
    };
    store.state().tokenIndex.tok_email_owner = user.id;
    const provider = createBirdEmailProvider(() => db, client);
    let enabled = false;
    const app = createDeveloperRoute({
      email: () => (enabled ? provider : undefined),
      db: () => db,
      user: (id) => (id === user.id ? user : undefined),
    });
    const request = (path: string, input: unknown) =>
      app.request(path, {
        method: 'POST',
        headers: { Authorization: 'Bearer tok_email_owner', 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
    expect((await app.request('/')).status).toBe(401);
    const disabled = await (
      await app.request('/', { headers: { Authorization: 'Bearer tok_email_owner' } })
    ).json();
    expect(disabled).toMatchObject({ emailEnabled: false, applicationEnabled: false });
    expect((await request('/email/send', { email: 'user@example.com' })).status).toBe(503);
    enabled = true;
    const status = await (
      await app.request('/', { headers: { Authorization: 'Bearer tok_email_owner' } })
    ).json();
    expect(status).toMatchObject({
      smsEnabled: false,
      emailEnabled: true,
      applicationEnabled: true,
    });
    expect((await request('/sms/send', { phone: '13800000000' })).status).toBe(503);
    expect((await request('/email/send', { email: 'bad' })).status).toBe(400);
    const sent = (await (await request('/email/send', { email: 'user@example.com' })).json()) as {
      challengeId: string;
    };
    const verified = (await (
      await request('/email/verify', { challengeId: sent.challengeId, code: '123456' })
    ).json()) as { verificationId: string };
    const issued = await request('/keys', {
      name: keyInput.name,
      tier: 'pure',
      verificationId: verified.verificationId,
    });
    expect(issued.status).toBe(201);
    expect(await issued.json()).toMatchObject({
      secret: expect.stringMatching(/^yl_/),
      key: { verification: 'email', verifiedEmail: 'user@example.com' },
    });
    expect(
      (
        await request('/keys', {
          name: keyInput.name,
          tier: 'pure',
          verificationId: verified.verificationId,
        })
      ).status,
    ).toBe(400);
    expect(
      (await request('/email/verify', { challengeId: sent.challengeId, code: '123456' })).status,
    ).toBe(400);
    expect(db.keys()).toHaveLength(1);
  });
});
