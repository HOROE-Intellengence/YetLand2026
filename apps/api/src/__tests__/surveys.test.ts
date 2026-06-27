import { beforeEach, describe, expect, it } from 'vitest';
import { store } from '../store/persistence';
import { clearPolicyCache } from '../services/policy';
import { mockSurveysRoute } from '../routes/surveys';
import { adminSurveysRoute } from '../routes/admin/surveys';

function addUser(id: string, name?: string) {
  store.state().users[id] = {
    id,
    name,
    phone: '13800000001',
    token: `tok_${id}`,
    ageVerified: true,
    narrativeBoundary: 2,
    ifUnlocked: false,
    createdAt: '2026-05-18T00:00:00.000Z',
    candle: 0,
    registerGrant: 0,
    conversationRounds: 0,
  };
}

describe('surveys feedback', () => {
  beforeEach(() => {
    store.__resetForTests();
    clearPolicyCache();
  });

  it('stores free-text feedback as a survey submission without reward', async () => {
    const res = await mockSurveysRoute.request('/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: '希望填空能进后台',
        characterId: 'shen-yan-zhi',
        source: 'survey-panel',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { accepted: boolean; rewarded: number };
    expect(body.accepted).toBe(true);
    expect(body.rewarded).toBe(0);

    expect(store.state().surveys.submissions).toHaveLength(1);
    expect(store.state().surveys.submissions[0]).toMatchObject({
      surveyId: 'feedback',
      rewarded: 0,
      source: 'survey-panel',
      answers: [
        {
          questionId: 'free_text',
          answer: {
            text: '希望填空能进后台',
            characterId: 'shen-yan-zhi',
          },
          dwellMs: 0,
        },
      ],
    });
  });

  it('exports stored answer content and user display names from admin surveys', async () => {
    addUser('usr_1', '小夜');
    store.state().surveys.submissions.push({
      userId: 'usr_1',
      surveyId: 'feedback',
      rewarded: 0,
      source: 'survey-panel',
      ts: '2026-05-18T00:00:00.000Z',
      answers: [{ questionId: 'free_text', answer: { text: '后台可见' }, dwellMs: 0 }],
    });

    const res = await adminSurveysRoute.request('/feedback/export');
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).toContain('userName');
    expect(csv).toContain('小夜');
    expect(csv).toContain('后台可见');
  });

  it('returns user display names with admin survey submissions', async () => {
    addUser('usr_2', '阿岚');
    store.state().surveys.submissions.push({
      userId: 'usr_2',
      surveyId: 'feedback',
      rewarded: 0,
      source: 'survey-panel',
      ts: '2026-05-18T00:00:00.000Z',
      answers: [{ questionId: 'free_text', answer: { text: '后台要能看见' }, dwellMs: 0 }],
    });

    const res = await adminSurveysRoute.request('/');
    expect(res.status).toBe(200);
    const body = await res.json() as { submissions: Array<{ userId: string; userName: string | null }> };
    expect(body.submissions[0]).toMatchObject({ userId: 'usr_2', userName: '阿岚' });
  });
});
