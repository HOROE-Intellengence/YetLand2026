# 会员 Mock 订阅闭环审计报告, 2026-05-27

## 结论

本轮已按产品经理手册推荐套餐落地灰测版订阅闭环：前端可从「续夜」入口选择月光 / 星河 / 永夜的周/月方案，后端立即模拟激活会员并发放赠烛，运营后台可调整价格、折扣、赠送量、上下架，并支持人工开通与到期不续。

真实支付没有接入，这是刻意保留接口的测试版。后续接微信 / 支付宝 / Stripe 时，应复用 `activateMembership`，只把 mock checkout 替换为网关下单 + webhook 验签。

## 影响范围

| 层级 | 改动 |
|---|---|
| Shared contracts | `packages/shared/src/contracts/billing.ts`、`contracts/admin.ts`、`types/subscription.ts`、`enums/candle-reason.ts` |
| API 服务 | `apps/api/src/services/membership.ts`、`services/membership-status.ts`、`routes/billing.ts`、`routes/admin/membership.ts`、`routes/pay/_helpers.ts`、`services/users.ts`、`store/persistence.ts`、`fixtures/billing.ts` |
| Admin | `apps/admin/src/routes/Membership.tsx`、`routes/registry.ts`、`components/Sidebar.tsx` |
| Web | `SubscriptionsPanel.tsx`、`CandleLedgerPanel.tsx`、`NarrativeCutoff.tsx`、`panel.module.css` |
| 测试 | `apps/api/src/__tests__/membership.test.ts` |

## 产品口径

- 套餐三档：月光、星河、永夜。
- 周期两档：周订阅、月订阅。
- 灰测默认价：月光 ¥9.9/周、¥29.9/月；星河 ¥19.9/周、¥59.9/月；永夜 ¥39.9/周、¥99.9/月。
- 赠烛默认量：月光 50/周、200/月；星河 150/周、600/月；永夜 400/周、1500/月。
- 会员权益：有效期内不触发免费轮次截断；订阅激活时一次性发放对应赠烛。

## 接口审计

| 接口 | 状态 | 说明 |
|---|---|---|
| `GET /api/billing/plans` | ✅ | 返回后台可配置的 active 套餐 |
| `GET /api/billing/subscription` | ✅ | 返回当前用户有效订阅或 null |
| `POST /api/billing/subscribe` | ✅ mock | 校验 plan/cycle 后立即激活订阅，返回 `mock: true` 与 `checkoutId` |
| `GET /api/admin/membership/plans` | ✅ | 返回全部套餐，含 inactive |
| `PATCH /api/admin/membership/plans/:planId` | ✅ | 更新价格、折扣、赠烛、文案、权益、上下架，写审计 |
| `GET /api/admin/membership/subscriptions` | ✅ | 查看近期订阅 |
| `POST /api/admin/membership/grant` | ✅ | 人工开通会员，可覆盖赠烛数量，写审计 |
| `POST /api/admin/membership/cancel` | ✅ | 标记到期不续，写审计 |

## 风险与后续

- 真实支付验签、订单状态机、退款和自动续费尚未接入，仍属上线前 F2。
- mock 层已有 `gatewayEventId` 订阅幂等与 `candleRef` 赠烛防重；真实付费上线前仍必须迁到 PG，并把这些幂等约束固化为数据库唯一键。
- 当前持久化仍是 `state.json`，不适合作为真实付费账务真相源。
- mock 支付会立即激活订阅，灰测数据不能当真实收入统计。
- 后台人工开通依赖运营输入正确 userId；生产前建议补用户搜索/选择器。

## 自动化覆盖

`membership.test.ts` 当前 8 个用例覆盖：套餐读取、mock 订阅激活、订阅赠烛、网关事件幂等、有效会员配额豁免、单一会员判定源、过期订阅转 `past_due`、后台套餐 patch、后台人工开通、到期不续与立即取消。

## 验收命令

```powershell
pnpm --filter @yelan/api test -- membership
pnpm --filter @yelan/shared typecheck
pnpm --filter @yelan/api typecheck
pnpm --filter @yelan/admin typecheck
pnpm --filter @yelan/web typecheck
```
