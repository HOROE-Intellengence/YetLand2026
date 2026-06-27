# Sprint：Phase 2 边缘层成型（2026-05-14）

> **窗口**：灰测开测后 Week 2-3
> **目标**：把 `apps/server` 升级为真正的边缘层一等公民，与 `apps/api` 之间的 `/api/*` 代理用 INTERNAL_TOKEN 加固
> **前置**：[ADR-0008](../tech/adr/0008-deployment-shape-decision.md) 方案 A + [ADR-0009](../tech/adr/0009-internal-token-design.md) INTERNAL_TOKEN 设计已 Accepted
> **总入场命令**：`pnpm verify:gray`（全绿才能合）

---

## 工单概览

| ID | 标题 | 优先级 | 预算 | 依赖 | 负责人 |
|---|---|---|---|---|---|
| **BE-135** | mock-fallback 出向注入 X-Internal-Token + 强制 HTTPS | P0 | 1 h | — | _待分配_ |
| **BE-142** | apps/api 校验 X-Internal-Token middleware | P0 | 1 h | BE-135 对端 | _待分配_ |
| **INFRA-104** | wrangler.toml + .env 配 INTERNAL_TOKEN | P0 | 30 min | BE-135/142 | _待分配_ |
| **INFRA-107** | Cloudflare Workers secrets 管理 SOP | P1 | 1 h | INFRA-104 | _待分配_ |
| **BE-134** | apps/server 14 个业务 stub → 503 让 fallback 接管 | P1 | 2 h | BE-135 已合 | _待分配_ |
| **BE-137** | 边缘 CORS 白名单化（删 `*`） | P0 | 30 min | — | _待分配_ |
| **BE-138** | 边缘 security headers（CSP/HSTS/X-Frame-Options） | P1 | 1 h | — | _待分配_ |
| **BE-136** | 边缘 rate-limit 接 Upstash 或 Cloudflare KV | P1 | 4-6 h | — | _待分配_ |
| **TEST-107** | 边缘层测试（fallback 守门 / token 验签 / rate-limit） | P0 | 1 d | BE-135/142/136/138 部分完成 | _待分配_ |

### 合并顺序

```
INFRA-104 (配 token)
  ↓
BE-142 (后端验)   ←→   BE-135 (边缘签)      ← 这两个必须几乎同时合
  ↓                         ↓
INFRA-107 (SOP)         BE-134 (14 stub → 503)
                            ↓
BE-137 / BE-138 / BE-136 （独立并行）
  ↓
TEST-107 （覆盖全部）
```

**关键约束**：BE-142 必须先于 BE-135 合，或两个 PR 同时 merge。否则：
- BE-135 先合 → 边缘签了 token，但后端不验，等于没签
- BE-142 先合 → 后端要求 token，但边缘不签，**线上 100% 失败**

实操：BE-142 先 merge 但**默认 INTERNAL_TOKEN_REQUIRED=false**（允许不带 token），BE-135 合后 + INFRA-104 部署后再翻 `true`。

### 通用规则

- 每个 PR 本地 `pnpm verify:gray` 全绿才提
- PR 描述粘 verify:gray 输出尾部
- 不允许新增 `Schema.parse(await c.req.json())` 残留
- 不允许在代码中 hardcode INTERNAL_TOKEN 值

---

## BE-135 — mock-fallback 出向注入 X-Internal-Token + 强制 HTTPS

**优先级**：P0 | **预算**：1 h | **依赖**：—

### 背景

ADR-0009 D3 决定 Worker → Node 后端的所有代理请求必须携带 `X-Internal-Token`。当前 `apps/server/src/routes/mock-fallback.ts:108-115` 只是把原 headers 透传过去，没注入内部 token。同时 `getMockFallbackBase` 也没强制 HTTPS——生产环境配错可能 fallback 到 HTTP 内网地址。

### 改什么

**1. 编辑 `apps/server/src/routes/mock-fallback.ts:95-100`** 加 HTTPS 守门：

```ts
export function getMockFallbackBase(env: Env): string | null {
  const explicitBase = env.MOCK_SERVER_BASE?.trim();
  const enabled = env.ENABLE_MOCK_FALLBACK === 'true' || env.ENABLE_MOCK_FALLBACK === '1';
  if (!enabled && !explicitBase) return null;

  const base = (explicitBase || 'http://127.0.0.1:8787').replace(/\/+$/, '');

  // 生产环境强制 HTTPS（开发态本地 http://127.0.0.1:8787 允许）
  const isProduction = env.ENV === 'production' || env.WORKERS_ENV === 'production';
  const isLocalhost = /^https?:\/\/(127\.0\.0\.1|localhost)/.test(base);
  if (isProduction && !base.startsWith('https://') && !isLocalhost) {
    console.error('[mock-fallback] MOCK_SERVER_BASE must be HTTPS in production:', base);
    return null;
  }

  return base;
}
```

（注：`env.ENV` 字段不存在的话，把判断条件改用其他 Env 字段，或新加。`apps/server/src/types/bindings.ts` Env 接口里如无 `ENV`，本工单顺手加 `ENV?: 'production' | 'staging' | 'development';`）

**2. 编辑 `apps/server/src/routes/mock-fallback.ts:108-110`** 注入 token：

```ts
const headers = new Headers(c.req.raw.headers);
headers.delete('host');

// ADR-0009 D3: 注入 X-Internal-Token，证明请求来自 Worker
if (c.env.INTERNAL_TOKEN) {
  headers.set('X-Internal-Token', c.env.INTERNAL_TOKEN);
} else if (c.env.ENV === 'production') {
  // 生产必须有 INTERNAL_TOKEN，否则拒绝代理
  return new Response(
    JSON.stringify({ code: 'INTERNAL_TOKEN_MISSING', message: 'INTERNAL_TOKEN not configured on edge' }),
    { status: 500, headers: { 'content-type': 'application/json' } }
  );
}
```

**3. 编辑 `apps/server/src/types/bindings.ts`** 把 `INTERNAL_TOKEN` 从可选改必选（在生产环境）：

```ts
// 配置
ADMIN_TOKEN: string;
INTERNAL_TOKEN: string;   // 改为必选（BE-131 时是占位的可选）
ENV?: 'production' | 'staging' | 'development';
```

注：CF Workers 的 Env 类型其实是 runtime 检查，把 `?` 删了 TS 不会自动校验值是否注入。配套 INFRA-104 在 wrangler.toml 写明。

### 验收

```bash
# 1. typecheck + verify:gray
pnpm --filter "./apps/server" run typecheck
pnpm verify:gray

# 2. 本地手测（mock-server 必须先起）
ADMIN_TOKEN=test-admin INTERNAL_TOKEN=test-internal-12345 \
  MOCK_SERVER_BASE=http://127.0.0.1:8787 \
  ENABLE_MOCK_FALLBACK=true \
  pnpm dev:server

# 2a. 通过 Worker 转发的请求应带 X-Internal-Token
# 在 apps/mock-server 加临时日志：app.use('*', (c, n) => { console.log('hdr:', c.req.header('x-internal-token')); return n(); })
curl http://localhost:8789/api/health
# 期望 mock-server 日志输出：hdr: test-internal-12345

# 2b. 生产模式 + 非 HTTPS base 应拒绝
ENV=production MOCK_SERVER_BASE=http://insecure.example.com pnpm dev:server
curl http://localhost:8789/api/health
# 期望：not found / null（getMockFallbackBase 返回 null）

# 2c. 生产模式 + 未配 INTERNAL_TOKEN 应 500
ENV=production INTERNAL_TOKEN= MOCK_SERVER_BASE=https://api.example.com pnpm dev:server
curl -i http://localhost:8789/api/health
# 期望：HTTP/1.1 500 + {"code":"INTERNAL_TOKEN_MISSING"}
```

### PR

- **分支**：`feat/be-135-mock-fallback-token-injection`
- **标题**：`feat(server): inject X-Internal-Token + enforce HTTPS on mock-fallback (BE-135)`
- **必须在 BE-142 已合或同 PR 后合**

### 关联

- ADR-0009 D2/D3
- BE-142 是对端验证

---

## BE-142 — apps/api 校验 X-Internal-Token middleware

**优先级**：P0 | **预算**：1 h | **依赖**：BE-135 对端

### 背景

ADR-0009 D1 决定 Node 后端必须校验来自 Worker 的 `X-Internal-Token`。本工单实现 middleware。

**关键设计**：加 `INTERNAL_TOKEN_REQUIRED` 开关。默认 `false`（允许直连兼容当前部署），上线时由 INFRA-104 翻 `true`。

### 改什么

**1. 新建 `apps/mock-server/src/middleware/internal-token.ts`**：

```ts
import type { MiddlewareHandler } from 'hono';
import { logError } from '../services/error-logger';

export function internalToken(): MiddlewareHandler {
  return async (c, next) => {
    const required = process.env.INTERNAL_TOKEN_REQUIRED === 'true';
    const expected = process.env.INTERNAL_TOKEN;
    const received = c.req.header('x-internal-token');

    if (!required) {
      // 兼容模式：不强制要求 token（current deployment 阶段）
      return next();
    }

    if (!expected) {
      // 配置错误：要求 token 但没配
      logError({
        ts: new Date().toISOString(),
        requestId: (c.get('requestId') as string) || 'unknown',
        method: 'INTERNAL_TOKEN',
        path: c.req.path,
        status: 500,
        code: 'INTERNAL_TOKEN_NOT_CONFIGURED',
        message: 'INTERNAL_TOKEN_REQUIRED=true but INTERNAL_TOKEN not set',
      });
      return c.json({ code: 'INTERNAL_TOKEN_NOT_CONFIGURED' }, 500);
    }

    if (!received) {
      logError({
        ts: new Date().toISOString(),
        requestId: (c.get('requestId') as string) || 'unknown',
        method: 'INTERNAL_TOKEN',
        path: c.req.path,
        status: 401,
        code: 'INTERNAL_TOKEN_MISSING',
        message: 'X-Internal-Token header missing',
      });
      return c.json({ code: 'INTERNAL_TOKEN_MISSING' }, 401);
    }

    if (received !== expected) {
      logError({
        ts: new Date().toISOString(),
        requestId: (c.get('requestId') as string) || 'unknown',
        method: 'INTERNAL_TOKEN',
        path: c.req.path,
        status: 401,
        code: 'INTERNAL_TOKEN_INVALID',
        message: 'X-Internal-Token mismatch',
      });
      return c.json({ code: 'INTERNAL_TOKEN_INVALID' }, 401);
    }

    await next();
  };
}
```

**2. 编辑 `apps/mock-server/src/index.ts`** 在 requestId 之后、各 route 之前注册：

```ts
import { internalToken } from './middleware/internal-token';
// ...
app.use('*', requestId());
app.use('/api/*', internalToken());   // ← 加这行
// 注意：/health 不挂这个 middleware，监控/CF Healthcheck 不带 token
```

（视实际 app 结构调整路径前缀；如果 `/admin/*` 不走 fallback 而是 SPA 直访，则不挂）

**3. 加单测 `apps/mock-server/src/__tests__/internal-token.test.ts`**：

- INTERNAL_TOKEN_REQUIRED 未设/false → 任何请求通过
- INTERNAL_TOKEN_REQUIRED=true 但 INTERNAL_TOKEN 未设 → 500 NOT_CONFIGURED
- 要求 + 配置 + 无 header → 401 MISSING
- 要求 + 配置 + 错 header → 401 INVALID
- 要求 + 配置 + 对 header → 通过

### 验收

```bash
pnpm verify:gray

# 单测
pnpm --filter "./apps/mock-server" run test src/__tests__/internal-token.test.ts
# expected: 5 passed

# 手测：兼容模式（默认）
unset INTERNAL_TOKEN_REQUIRED
pnpm dev:mock &
curl http://localhost:8787/api/health   # 期望 200（不要求 token）

# 手测：强制模式
INTERNAL_TOKEN_REQUIRED=true INTERNAL_TOKEN=test-12345 pnpm dev:mock &
curl -i http://localhost:8787/api/health                              # 期望 401 MISSING
curl -i -H 'X-Internal-Token: wrong' http://localhost:8787/api/health  # 期望 401 INVALID
curl -i -H 'X-Internal-Token: test-12345' http://localhost:8787/api/health  # 期望 200
```

### PR

- **分支**：`feat/be-142-internal-token-middleware`
- **标题**：`feat(api): add X-Internal-Token verification middleware (BE-142)`
- **必须先合，或与 BE-135 同时合**

### 关联

- ADR-0009 D1/D3
- 配套 INFRA-104 翻开关

---

## INFRA-104 — wrangler.toml + .env 配 INTERNAL_TOKEN

**优先级**：P0 | **预算**：30 min | **依赖**：BE-135 + BE-142 已合

### 背景

ADR-0009 D2：Worker 端用 CF Dashboard Secrets，Node 端用 `.env`。本工单把这两边都配通，并把生产环境 `INTERNAL_TOKEN_REQUIRED=true`。

### 改什么

**1. 生成 token**：

```bash
openssl rand -hex 32
# 例：a3f8b2c9d1e4f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1
```

**2. Worker 端**：

- Cloudflare Dashboard → Workers → `apps-server` → Settings → Variables → Environment Variables
- 新增 Secret `INTERNAL_TOKEN` = `<上面生成的 hex>`
- 新增 Variable `ENV` = `production`
- 新增 Secret `ADMIN_TOKEN` = `<另一个强随机>`（如果还没配）
- 验证：`wrangler secret list` 应包含 INTERNAL_TOKEN

**3. wrangler.toml 加占位**（不存值，标注必填）：

编辑 `apps/server/wrangler.toml`：

```toml
[vars]
# 公开变量（非 secret）
ENV = "production"
ENABLE_MOCK_FALLBACK = "true"
MOCK_SERVER_BASE = "https://api.example.com"  # 改成真实生产域名

# Secrets（用 wrangler secret put 或 Dashboard 注入）：
#   INTERNAL_TOKEN  — ADR-0009，与 apps/api 一致
#   ADMIN_TOKEN     — admin 后台鉴权
#   ANTHROPIC_API_KEY / OPENAI_API_KEY / DEEPSEEK_API_KEY — LLM
```

**4. Node 端 `.env`**（生产服务器）：

```bash
# apps/api 容器或主机的 .env 加：
INTERNAL_TOKEN=<与 Worker 端完全相同的值>
INTERNAL_TOKEN_REQUIRED=true
```

**5. `infra/deploy/.env.example` 加占位**：

```bash
# ADR-0009: 边缘 ↔ Node 后端互验内部 token
# 生产环境必须设，且与 Cloudflare Workers Secret INTERNAL_TOKEN 完全相同
INTERNAL_TOKEN=
INTERNAL_TOKEN_REQUIRED=true
```

**6. `.env.example`（根）同步加占位**。

### 验收

```bash
# 1. Worker 端
wrangler secret list --name apps-server
# expected: 含 INTERNAL_TOKEN, ADMIN_TOKEN

# 2. Node 端
docker compose exec api env | grep INTERNAL_TOKEN
# expected: INTERNAL_TOKEN=<value> 和 INTERNAL_TOKEN_REQUIRED=true

# 3. 端到端
# 部署 Worker → curl 真实生产地址
curl -i https://api.example.com/api/health
# expected: 200（通过）

# 直连 Node 后端（绕过 Worker）
curl -i https://api-internal.example.com/api/health
# expected: 401 INTERNAL_TOKEN_MISSING

# 直连 + 错 token
curl -i -H 'X-Internal-Token: wrong' https://api-internal.example.com/api/health
# expected: 401 INTERNAL_TOKEN_INVALID
```

### PR

- **分支**：`infra/infra-104-internal-token-config`
- **标题**：`infra: wire INTERNAL_TOKEN to Worker secrets + .env (INFRA-104)`
- **注意**：PR 描述里**绝对不能贴真实 token 值**，只贴占位说明

### 关联

- ADR-0009 D2
- 配套 INFRA-107 SOP

---

## INFRA-107 — Cloudflare Workers secrets 管理 SOP

**优先级**：P1 | **预算**：1 h | **依赖**：INFRA-104

### 背景

INFRA-104 把 token 设上去了，但运维换人 / token 泄露 / 新加 secret 时没有标准流程。本工单写一份 SOP，避免后续靠口口相传。

### 改什么

新建 `docs/operations/secrets-management.md`：

```markdown
# Secrets 管理 SOP

## Token 清单

| Token | 持有方 | 验证方 | 来源 | 轮转触发 |
|---|---|---|---|---|
| INTERNAL_TOKEN | Worker secrets | Node `.env` | ADR-0009 D2 | 人员离职 / 疑似泄露 |
| ADMIN_TOKEN | 运维记忆 | Worker + Node | 强随机 | 同上 |
| ANTHROPIC_API_KEY | Worker + Node | LLM 提供商 | Anthropic Dashboard | 账单异常 / 配额超 |
| ... | | | | |

## 操作流程

### 添加新 secret
1. 生成值：`openssl rand -hex 32`（共享密钥）或外部 dashboard 拿（API key）
2. Worker 端：`wrangler secret put <NAME>` 或 CF Dashboard
3. Node 端：改 `.env` + `docker compose restart api`
4. 在本文档"Token 清单"加一行
5. 写入 CHANGELOG

### 轮转现有 secret
1. 生成新值
2. **先 Worker，后 Node**（如果是单向通信）或 **同时**（双向）
3. 改完用 §验证命令 跑一遍
4. 旧值在所有持有方都更新后 invalidate

### 应急（疑似泄露）
按 ADR-0009 §应急 SOP，目标 1 小时内完成。

## 验证命令
（与 INFRA-104 §验收 一致）

## 谁有权限
- INTERNAL_TOKEN / ADMIN_TOKEN：架构 + 运维 lead（至少 2 人，互为备份）
- LLM API Keys：财务 + 架构（计费责任）
- 任何变更需在 ops 频道公告
```

### 验收

- 文档 review 通过（架构 + 运维 lead 各 1 个 LGTM）
- README docs 索引加这条
- ops 频道 pin 链接

### PR

- **分支**：`docs/infra-107-secrets-sop`
- **标题**：`docs(ops): secrets management SOP (INFRA-107)`

---

## BE-134 — apps/server 14 个业务 stub → 503 让 fallback 接管

**优先级**：P1 | **预算**：2 h | **依赖**：BE-135 已合 + INFRA-104 部署完

### 背景

ADR-0008 方案 A 决定 `apps/server` 当边缘层，所有业务逻辑由 fallback 代理到 Node 后端。但当前 14 个业务路由文件还有 stub 返回 `[]` / `null` / `'TODO'`——这些 stub 会**优先于 fallback 命中**，让用户看到假数据。

清理这些 stub，让 fallback 接管。

### 改什么

**14 个文件**（见 `接口审计与TODO.md §三 A`）：

```
apps/server/src/routes/
├── billing.ts        — 6 端点
├── characters.ts     — GET 全列表 + unlock
├── sessions.ts
├── achievements.ts
├── surveys.ts
├── events.ts
├── if-codes.ts
├── logs.ts
└── admin/
    ├── candle.ts
    ├── quota.ts
    ├── users.ts
    ├── prompts.ts
    ├── costs.ts
    └── surveys.ts
```

**方案 A（推荐 — 删整个文件）**：
- 删除整个路由文件
- 编辑 `apps/server/src/index.ts` 把对应的 `app.route(...)` 也删掉
- not-found handler 让 fallback 接管（已实现：`proxyToMockOr404`）

**方案 B（保险 — 每个端点替换为 503）**：
- 把每个 handler 改成：
  ```ts
  return c.json({ code: 'BACKEND_UNAVAILABLE', message: 'route handled by fallback' }, 503);
  ```
- 优点：删错时还能回滚；缺点：不让 fallback 真接管，只是显式失败

**实操建议**：先方案 A，每删一个文件本地跑一遍 verify:gray 确认 fallback 接得上；如果 fallback 路径没覆盖某个端点，那个文件改方案 B 保留。

### 不能删的 4 个

`保留型`（[ADR-0008](../tech/adr/0008-deployment-shape-decision.md) §"保留为 stub 不动"）：

- `apps/server/src/routes/auth.ts` — 上线接短信 OTP
- `apps/server/src/routes/pay/{wechat,alipay,stripe}.ts` — 上线接支付验签
- `apps/server/src/db/*.ts` — Worker 直连 DB 路线的留备
- `apps/server/src/llm/providers/*.ts` — Worker 直连 LLM 路线的留备

这些标 stub + 加注释"等 Phase 5 真接通"。

### 验收

```bash
pnpm verify:gray

# 端到端：以前从 apps/server 直拿假数据的端点，现在应走 fallback 拿真数据
curl http://localhost:8789/api/characters
# expected: 真实角色卡列表（mock-server 提供），不是 []

curl http://localhost:8789/api/admin/users -H 'X-Admin-Token: ...'
# expected: 真实用户列表，不是预设
```

### PR

- **分支**：`refactor/be-134-remove-server-stubs`
- **标题**：`refactor(server): remove business stubs, let fallback handle (BE-134)`

### 关联

- ADR-0008 §"S2 14 个业务 stub 整理"
- 接口审计与TODO.md §三 A

---

## BE-137 — 边缘 CORS 白名单化

**优先级**：P0 | **预算**：30 min | **依赖**：—

### 背景

`apps/server/src/middleware/cors.ts:5` 当前可能是 `Access-Control-Allow-Origin: *`（接口审计 §五 标记）。生产环境必须改白名单。

### 改什么

**1. 编辑 `apps/server/src/middleware/cors.ts`**：

```ts
import { cors } from 'hono/cors';
import type { MiddlewareHandler } from 'hono';
import type { Env } from '../types/bindings';

const ALLOWED_ORIGINS = (env: Env): string[] => {
  const raw = env.CORS_ORIGINS ?? '';
  return raw.split(',').map(s => s.trim()).filter(Boolean);
};

export function corsMiddleware(): MiddlewareHandler<{ Bindings: Env }> {
  return cors({
    origin: (origin, c) => {
      const allowed = ALLOWED_ORIGINS(c.env);
      if (allowed.length === 0) {
        // 未配置：开发态允许，生产态拒
        return c.env.ENV === 'production' ? null : origin;
      }
      return allowed.includes(origin) ? origin : null;
    },
    credentials: true,
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'X-Admin-Token', 'Content-Type'],
  });
}
```

**2. 编辑 `apps/server/src/types/bindings.ts`** 加 `CORS_ORIGINS?: string`。

**3. wrangler.toml 配生产值**：

```toml
[vars]
CORS_ORIGINS = "https://yelan.example.com,https://admin.yelan.example.com"
```

### 验收

```bash
# 白名单内
curl -i -H 'Origin: https://yelan.example.com' https://api.example.com/api/health
# expected: Access-Control-Allow-Origin: https://yelan.example.com

# 白名单外
curl -i -H 'Origin: https://attacker.com' https://api.example.com/api/health
# expected: 无 Access-Control-Allow-Origin 头（浏览器会拦）
```

### PR

- **分支**：`fix/be-137-cors-whitelist`
- **标题**：`fix(server): CORS whitelist via env, drop wildcard (BE-137)`

---

## BE-138 — 边缘 security headers

**优先级**：P1 | **预算**：1 h | **依赖**：—

### 背景

生产 Worker 应统一注入 CSP / HSTS / X-Frame-Options / X-Content-Type-Options 等安全 header，避免 clickjacking / MIME sniffing / 中间人。

### 改什么

新建 `apps/server/src/middleware/security-headers.ts`：

```ts
import type { MiddlewareHandler } from 'hono';
import type { Env } from '../types/bindings';

export function securityHeaders(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    await next();
    const res = c.res;

    // CSP — 起始版本，后续按页面调整
    res.headers.set(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https:;"
    );

    // HSTS — 1 年 + 子域 + preload
    if (c.env.ENV === 'production') {
      res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }

    res.headers.set('X-Frame-Options', 'DENY');
    res.headers.set('X-Content-Type-Options', 'nosniff');
    res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.headers.set('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  };
}
```

编辑 `apps/server/src/index.ts` 把这个 middleware 挂上。

### 验收

```bash
curl -I https://api.example.com/api/health
# expected: 含上述 6 个 header
```

### PR

- **分支**：`feat/be-138-security-headers`
- **标题**：`feat(server): add CSP/HSTS/X-Frame-Options security headers (BE-138)`

---

## BE-136 — 边缘 rate-limit 接 Upstash 或 Cloudflare KV

**优先级**：P1 | **预算**：4-6 h | **依赖**：—

### 背景

生产环境的 `/api/*` 需要按 IP + 用户限频，防刷防 DDoS。CF Workers 跑在边缘，最自然的存储是 Cloudflare KV 或 Durable Objects；外部 Upstash Redis 也是常见方案。

### 决策点（PR 开始前 PM/架构定）

| 选项 | 好处 | 代价 |
|---|---|---|
| **Cloudflare KV** | 零额外服务，CF 原生 | KV 写入有 60s eventual consistency，限频粒度粗 |
| **Cloudflare Durable Objects** | 强一致，按 key 分区 | 学习成本 + 计费按 instance |
| **Upstash Redis (REST)** | Redis 标准，可换 self-host | 引入外部依赖 + 多一跳延迟 |

**建议**：先用 KV 起步，灰测足够；上线后看流量决定是否升级 DO 或 Upstash。

### 改什么（KV 路径）

**1. 编辑 `apps/server/src/middleware/rate-limit.ts`**：

```ts
import type { MiddlewareHandler } from 'hono';
import type { Env } from '../types/bindings';
import { AppError } from './error';

const DEFAULT_LIMIT = 60;  // 每 IP 每分钟 60 次
const WINDOW_SECONDS = 60;

export function rateLimit(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    if (!c.env.RATE_LIMIT_KV) {
      // 未配 KV → 跳过（开发态）
      return next();
    }

    const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
    const bucket = Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
    const key = `rl:${ip}:${bucket}`;

    const current = Number((await c.env.RATE_LIMIT_KV.get(key)) ?? 0);
    if (current >= DEFAULT_LIMIT) {
      throw new AppError(429, 'RATE_LIMIT_EXCEEDED', `Too many requests (limit ${DEFAULT_LIMIT}/min)`);
    }

    // 写回（CF KV 的 TTL 自动过期）
    await c.env.RATE_LIMIT_KV.put(key, String(current + 1), { expirationTtl: WINDOW_SECONDS * 2 });

    await next();
  };
}
```

**2. 编辑 `apps/server/src/types/bindings.ts`** 加 `RATE_LIMIT_KV?: KVNamespace;`。

**3. wrangler.toml 绑 KV namespace**：

```toml
[[kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "<cf-dashboard-生成的-id>"
```

**4. 编辑 `apps/server/src/index.ts`** 挂载：

```ts
app.use('/api/*', rateLimit());   // 在 internalToken 之后（先识别身份）
```

**5. 加单测 + 集成测**。

### 验收

```bash
# 60 个请求内通过
for i in {1..60}; do curl -s -o /dev/null -w '%{http_code} ' https://api.example.com/api/health; done

# 第 61 个开始 429
curl -i https://api.example.com/api/health
# expected: 429 + {"code":"RATE_LIMIT_EXCEEDED"}
```

### PR

- **分支**：`feat/be-136-rate-limit-kv`
- **标题**：`feat(server): rate-limit via Cloudflare KV (BE-136)`

---

## TEST-107 — 边缘层测试

**优先级**：P0 | **预算**：1 d | **依赖**：BE-135/142/136/138 部分完成

### 背景

Phase 2 涉及边缘层多项关键变更，必须有自动化回归覆盖。`apps/server` 当前没有测试目录。

### 改什么

新建 `apps/server/src/__tests__/`：

**1. `mock-fallback.test.ts`**（覆盖 BE-135）：
- 未配 INTERNAL_TOKEN + 生产模式 → 500
- 配 token → 代理请求带 X-Internal-Token header
- 生产模式 + 非 HTTPS base → 拒代理
- getMockFallbackBase 各种 env 组合的返回值

**2. `internal-token-edge.test.ts`**（模拟 BE-142 行为，apps/server 端）：
- 由 mock 的 mock-server 验证 token 是否被注入

实际 BE-142 的单测在 mock-server 端，这里只测 server 是否 sign。

**3. `admin-auth.test.ts`**（覆盖 BE-131 既有 + 巩固）：
- 无 token → 401
- 错 token → 401
- 对 token → 200

**4. `security-headers.test.ts`**（覆盖 BE-138）：
- 响应含 CSP / HSTS / X-Frame-Options
- 生产环境 HSTS 存在；开发环境不存在

**5. `cors.test.ts`**（覆盖 BE-137）：
- 白名单内 origin → 通过
- 白名单外 → 无 ACAO
- 未配置 + 开发 → 反射 origin
- 未配置 + 生产 → 拒

**6. `rate-limit.test.ts`**（覆盖 BE-136）：
- 用假 KV 注入 → 60 次内通过，第 61 次 429
- 不同 IP 各自计数

**7. 在 `package.json` apps/server 加 `test` 脚本**（vitest）+ 在根 `verify:gray` 加 `apps/server` test 调用。

### 验收

```bash
pnpm --filter "./apps/server" run test
# expected: 6 个测试文件全 passed，每个文件 4-8 个 case

pnpm verify:gray   # 全绿，且包含 apps/server test
```

### PR

- **分支**：`test/test-107-edge-layer`
- **标题**：`test(server): add edge layer tests covering Phase 2 (TEST-107)`

### 关联

- 覆盖 BE-131（巩固）+ BE-135 + BE-137 + BE-138 + BE-136
- 替代旧 TEST-105（已并入）

---

## Sprint Definition of Done

- [ ] **BE-142** PR merged，internal-token middleware 5 个 case 全 passed
- [ ] **BE-135** PR merged（与 BE-142 同时或之后），mock-fallback 注入 + HTTPS 守门生效
- [ ] **INFRA-104** PR merged，wrangler.toml / .env.example 占位完整；生产 secrets 已配（不进 Git）
- [ ] **INFRA-107** SOP 文档 review 通过，secrets 管理流程明确
- [ ] **BE-134** PR merged，14 个 stub 删完或标 503，端到端真数据通过 fallback 取
- [ ] **BE-137** PR merged，CORS 白名单生效；攻击者 origin 无 ACAO
- [ ] **BE-138** PR merged，CSP/HSTS/X-Frame 头部到位
- [ ] **BE-136** PR merged，60/min 限频生效
- [ ] **TEST-107** PR merged，apps/server 测试套件就位
- [ ] **生产部署演练**：按 INFRA-107 SOP 在 staging 完整走一遍 INTERNAL_TOKEN 配置 + 部署 + 验证
- [ ] **接口审计与TODO.md** §三 A 把 14 个 stub 标 ✅ removed

---

## Phase 3 启动条件

Phase 2 全部 ✅ 后，启动 Phase 3 主后端生产化：

- BE-139 改名 `apps/mock-server → apps/api`
- BE-140 Postgres 接入
- BE-141 state.json → PG 迁移
- INFRA-105 Docker 生产 compose
- INFRA-108 监控告警
- TEST-109 e2e

工单文件预留：`docs/sprint/2026-05-XX-backend-production.md`（待 Phase 2 收尾后写）。
