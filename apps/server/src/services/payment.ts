export interface PaymentProvider {
  name: 'wechat' | 'alipay' | 'stripe';
  createIntent(args: { userId: string; planId: string; cycle: 'week' | 'month'; amount: number; currency: string }): Promise<{ paymentUrl: string; intentId: string }>;
  verifyWebhook(headers: Record<string, string>, raw: string): Promise<{ valid: boolean; eventId: string; payload: unknown }>;
}

// TODO: 接入真实支付网关
// - createWechatProvider: 微信支付 JSAPI / Native
// - createAlipayProvider: 支付宝网页/App 支付
// - createStripeProvider: Stripe Checkout / Payment Intent
