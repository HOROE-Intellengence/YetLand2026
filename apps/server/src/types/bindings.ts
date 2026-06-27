// Cloudflare Workers 的环境绑定。secrets 用 wrangler secret put 注入
export interface Env {
  // LLM
  ANTHROPIC_API_KEY: string;
  OPENAI_API_KEY: string;
  DEEPSEEK_API_KEY: string;
  UNLIM_WORKER_URL: string;

  // 数据库
  DB?: D1Database;
  DATABASE_URL: string;
  REDIS_URL: string;

  // 配置
  NARRATIVE_BOUNDARY_GLOBAL: string;
  ENABLE_MOCK_FALLBACK?: string;
  MOCK_SERVER_BASE?: string;
  ADMIN_TOKEN: string;
  INTERNAL_TOKEN: string;
  ENV?: 'production' | 'staging' | 'development';
  CORS_ORIGINS?: string;

  // 支付
  WECHAT_PAY_MCH_ID?: string;
  WECHAT_PAY_KEY?: string;
  ALIPAY_APP_ID?: string;
  ALIPAY_PRIVATE_KEY?: string;
  STRIPE_SECRET_KEY?: string;

  // KV
  PROMPTS_KV?: KVNamespace;
  RATE_LIMIT_KV?: KVNamespace;

  // 监控
  SENTRY_DSN_SERVER?: string;
}
