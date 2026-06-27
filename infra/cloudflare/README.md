# Cloudflare 资源

## Workers

| 名称 | 仓库路径 | 域名 | 部署 |
|---|---|---|---|
| `yelan-server` | `apps/server` | `api.yelan.app` | wrangler deploy |
| `yelan-unlim` | `apps/unlim-worker` | `unlim.yelan.workers.dev` | wrangler deploy |

## KV

| binding | 用途 |
|---|---|
| `PROMPTS_KV` | 灰度 Prompt 版本（character / strategy / boundary） |

## R2 / D1

Phase 1 不使用。

## Secrets（用 `wrangler secret put`）

每个 Worker 独立一份：

```
ANTHROPIC_API_KEY
OPENAI_API_KEY
DEEPSEEK_API_KEY
NVIDIA_API_KEY        # 仅 unlim-worker
DATABASE_URL
REDIS_URL
WECHAT_PAY_KEY
ALIPAY_PRIVATE_KEY
STRIPE_SECRET_KEY
SENTRY_DSN_SERVER
```

## 部署清单

1. `wrangler login` —— 授权
2. `wrangler kv:namespace create PROMPTS_KV` —— 拿到 id 写回 `wrangler.toml`
3. 给每个 Worker 跑 `wrangler secret put <NAME>`
4. `pnpm --filter @yelan/server deploy`
5. `pnpm --filter @yelan/unlim-worker deploy`
