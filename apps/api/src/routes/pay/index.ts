// 支付回调入口（mock）— 与 apps/server/src/routes/pay/index.ts 路径一致
// 本地不真接支付平台；callback POST 直接当成功入账（便于联调订阅成功后的分支）
import { Hono } from 'hono';
import { wechatRoute } from './wechat';
import { alipayRoute } from './alipay';
import { stripeRoute } from './stripe';

export const mockPayRoute = new Hono();
mockPayRoute.route('/wechat', wechatRoute);
mockPayRoute.route('/alipay', alipayRoute);
mockPayRoute.route('/stripe', stripeRoute);
