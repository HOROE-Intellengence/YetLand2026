import { beforeEach, describe, expect, it } from 'vitest';
import { store } from '../store/persistence';
import { mockMeRoute } from '../routes/me';
import { mockCharactersRoute } from '../routes/characters';
import { charactersService } from '../services/characters';
import { loadCharacterCard } from '../prompts/loader';

function makeUser(id: string, token: string) {
  const s = store.state();
  s.users[id] = {
    id,
    token,
    ageVerified: true,
    narrativeBoundary: 2,
    ifUnlocked: false,
    createdAt: new Date().toISOString(),
    candle: 100,
    registerGrant: 100,
    conversationRounds: 0,
    nickname: id,
  };
  s.tokenIndex[token] = id;
  return { id, token };
}

async function createCard(token: string, body: unknown) {
  return mockMeRoute.request('/created-characters', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('用户自定义角色卡 — 创建', () => {
  beforeEach(() => store.__resetForTests());

  it('未登录（无 token）创建 → 401', async () => {
    const res = await mockMeRoute.request('/created-characters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '匿名', consent: true }),
    });
    expect(res.status).toBe(401);
  });

  it('缺 consent → 400（第二步确认必须通过）', async () => {
    const { token } = makeUser('usr_a', 'tok_a');
    const res = await createCard(token, { name: '只填名' });
    expect(res.status).toBe(400);
  });

  it('只填角色名即可创建，返回档案 JSON（角色名/用户名/id）', async () => {
    const { id: uid, token } = makeUser('usr_a', 'tok_a');
    const res = await createCard(token, { name: '林深', consent: true });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      character: { id: string; name: string; origin: string; reviewStatus: string };
      profile: { id: string; characterName: string; userName: string; ownerUserId: string };
    };
    expect(body.character.name).toBe('林深');
    expect(body.character.origin).toBe('user');
    expect(body.character.reviewStatus).toBe('private');
    expect(body.profile.characterName).toBe('林深');
    expect(body.profile.userName).toBe('usr_a');
    expect(body.profile.ownerUserId).toBe(uid);
  });

  it('世界书+角色卡编译进 profileSections，prompt 能渲染', async () => {
    const { token } = makeUser('usr_a', 'tok_a');
    const res = await createCard(token, {
      name: '沈砚之',
      worldbook: { background: '旧城归人', rules: '夜里不谈往事' },
      card: { initialState: { location: '书房', action: '临帖' }, tabooExpressions: ['亲爱的'] },
      consent: true,
    });
    const { character } = (await res.json()) as { character: { id: string } };
    const prompt = loadCharacterCard(character.id);
    expect(prompt).toContain('设定细节');
    expect(prompt).toContain('- 背景：旧城归人');
    expect(prompt).toContain('- 初始状态：位置：书房；动作：临帖');
    expect(prompt).toContain('禁用语：亲爱的');
  });
});

describe('用户自定义角色卡 — 可见性与越权', () => {
  beforeEach(() => store.__resetForTests());

  it('私有卡：本人可见可访问，他人列表看不到且详情 404', async () => {
    const { token: tokenA } = makeUser('usr_a', 'tok_a');
    makeUser('usr_b', 'tok_b');
    const res = await createCard(tokenA, { name: '仅我可见', consent: true });
    const { character } = (await res.json()) as { character: { id: string } };

    // A 的列表能看到
    const listA = await mockCharactersRoute.request('/', {
      headers: { Authorization: 'Bearer tok_a' },
    });
    const arrA = (await listA.json()) as Array<{ id: string }>;
    expect(arrA.some((c) => c.id === character.id)).toBe(true);

    // B 的列表看不到
    const listB = await mockCharactersRoute.request('/', {
      headers: { Authorization: 'Bearer tok_b' },
    });
    const arrB = (await listB.json()) as Array<{ id: string }>;
    expect(arrB.some((c) => c.id === character.id)).toBe(false);

    // B 直接查详情 → 404（不暴露存在性）
    const detailB = await mockCharactersRoute.request(`/${character.id}`, {
      headers: { Authorization: 'Bearer tok_b' },
    });
    expect(detailB.status).toBe(404);

    // 服务层越权判定（聊天护栏同源）
    expect(charactersService.canAccess(character.id, 'usr_a')).toBe(true);
    expect(charactersService.canAccess(character.id, 'usr_b')).toBe(false);
  });

  it('申请公开 → reviewStatus=pending，审核前仍不进他人公共列表', async () => {
    const { token: tokenA } = makeUser('usr_a', 'tok_a');
    makeUser('usr_b', 'tok_b');
    const res = await createCard(tokenA, { name: '待审角色', makePublic: true, consent: true });
    const { character } = (await res.json()) as { character: { id: string; reviewStatus: string } };
    expect(character.reviewStatus).toBe('pending');

    const listB = await mockCharactersRoute.request('/', {
      headers: { Authorization: 'Bearer tok_b' },
    });
    const arrB = (await listB.json()) as Array<{ id: string }>;
    expect(arrB.some((c) => c.id === character.id)).toBe(false);
  });
});
