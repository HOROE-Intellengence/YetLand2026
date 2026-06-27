// 充值额度复现探针 —— 验证「充值后剩余额度/会员态」的变化
// 用法：pnpm --filter @yelan/api exec tsx scripts/probe-recharge-quota.ts
//
// 背景：用户侧充值 = POST /api/billing/subscribe（开通会员）。会员在 consumeOneRound
// 里直接绕过每日额度闸门，不消耗也不增加 free/bonus。所以「剩余额度」对会员表现为
// 「不限」，而非有限分母变大。本探针打印充值前后的 getQuotaForDate + /quota 的 membership。
import { store } from '../src/store/persistence';
import { mockBillingRoute } from '../src/routes/billing';
import { consumeOneRound, getQuotaForDate } from '../src/services/users';

function setup() {
  store.__resetForTests();
  const userId = 'usr_recharge';
  const token = 'tok_recharge';
  store.state().users[userId] = {
    id: userId, phone: '13800001111', token,
    ageVerified: true, narrativeBoundary: 2, ifUnlocked: false,
    createdAt: new Date().toISOString(), candle: 100, registerGrant: 100,
    conversationRounds: 0,
  };
  store.state().tokenIndex[token] = userId;
  store.state().phoneIndex['13800001111'] = userId;
  store.save();
  return { userId, token };
}

async function fetchQuota(token: string) {
  const res = await mockBillingRoute.request('/quota', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json() as Promise<{
    freeLimit: number; freeUsed: number; bonusLimit: number; bonusUsed: number; membership: boolean;
  }>;
}

function snapshot(userId: string) {
  const q = getQuotaForDate(userId);
  return { freeUsed: q.freeUsed, freeLimit: q.freeLimit, bonusUsed: q.bonusUsed, bonusLimit: q.bonusLimit, remaining: q.remaining };
}

async function main() {
  const { userId, token } = setup();

  // 把今天的免费额度用到只剩 1，模拟「快用完了去充值」的真实场景
  const before0 = getQuotaForDate(userId);
  store.state().quota[userId]![before0.date]!.freeUsed = before0.freeLimit - 1;
  store.save();

  console.log('\n████████ 充值前 ████████');
  console.log('  getQuotaForDate :', snapshot(userId));
  console.log('  /quota          :', await fetchQuota(token));

  // 充值：开通会员
  const sub = await mockBillingRoute.request('/subscribe', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ planId: 'moonlight', cycle: 'month' }),
  });
  console.log('\n  → POST /subscribe status =', sub.status);

  console.log('\n████████ 充值后 ████████');
  console.log('  getQuotaForDate :', snapshot(userId));
  console.log('  /quota          :', await fetchQuota(token));

  // 关键验收：充值前免费额度已耗尽时 consumeOneRound 应放行（会员绕闸门）
  store.state().quota[userId]![before0.date]!.freeUsed = before0.freeLimit;
  store.save();
  console.log('\n  freeUsed=freeLimit 后 consumeOneRound() =', consumeOneRound(userId), '(期望 true：会员放行)');

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
