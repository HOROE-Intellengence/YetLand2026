// 支付回调入口。各 provider 用同一 PaymentProvider 接口（services/payment/provider.ts）
// 关键: 回调走 INSERT ON CONFLICT DO NOTHING + 唯一索引(gateway_event_id) 保证幂等
import { Hono } from 'hono';
import type { Env } from '../../types/bindings';
import { wechatRoute } from './wechat';
import { alipayRoute } from './alipay';
import { stripeRoute } from './stripe';

export const payRoute = new Hono<{ Bindings: Env }>();

payRoute.route('/wechat', wechatRoute);
payRoute.route('/alipay', alipayRoute);
payRoute.route('/stripe', stripeRoute);
