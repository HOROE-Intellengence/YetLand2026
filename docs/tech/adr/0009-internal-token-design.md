# ADR-0009: INTERNAL_TOKEN 设计（边缘层 ↔ Node 后端互验）

- **状态**: Accepted
- **日期**: 2026-05-14
- **决策者**: 架构 + PM + 运维
- **前置**: [ADR-0008](0008-deployment-shape-decision.md) 方案 A（Worker edge + Node 主后端）

## 背景

ADR-0008 决定 `apps/server`（Cloudflare Worker）当边缘层、`apps/api`（前身 mock-server）当 Node 主后端，两者之间靠 `mock-fallback.ts` 代理 `/api/*`。这条代理通道必须有"内部签证"防止三种攻击：

1. **直暴攻击**：攻击者绕过 Worker 直接打 mock-server 公网地址
2. **请求伪造**：第三方冒充 Worker 发请求
3. **配置漂移**：误把 ENABLE_MOCK_FALLBACK 指向不可信的 mock-server

需要一个共享密钥机制让 mock-server 能识别"这个请求确实是从我们的 Worker 来的"。

## 决策（4 个决策点）

### D1. Token 格式 — **纯文本共享密钥**

```
INTERNAL_TOKEN=<32+ 字节随机 hex 字符串>
```

| 选项 | 选择 |
|---|---|
| **纯文本共享密钥** | ✅ 采纳 |
| HMAC-SHA256 签名 | ❌ |
| JWT (HS256) | ❌ |

**理由**：对标已有的 `ADMIN_TOKEN`，零依赖、curl 可测、运维心智模型一致。HMAC/JWT 的"可验证签发者 / 可带 claims"在当前威胁模型下没有实际收益——只有两端互信，不需要第三方验签。

### D2. 存储 — **两端独立配置**

| 持有方 | 存储位置 | 操作方式 |
|---|---|---|
| `apps/server` (Worker) | Cloudflare Dashboard → Workers → Settings → Variables → Secrets | 浏览器填，运维无需 CLI |
| `apps/api` (Node 后端) | `.env` 文件 | 未来迁移到 `app_config` 表（数据库 row） |

**理由**：Workers secrets 是 CF 官方推荐的 secrets 管理路径，加密静态、不进 Git；Node 端用 `.env` 与现有配置体系一致，未来 DB 化时只换读取层。

**两端必须配置相同值**——这是手动同步责任，由运维在轮转时确保。

### D3. 携带方式 — **HTTP Header `X-Internal-Token`**

```http
POST /api/chat HTTP/1.1
Authorization: Bearer <user-token>
X-Internal-Token: <internal-token>
Content-Type: application/json
```

| 选项 | 选择 |
|---|---|
| **`X-Internal-Token: <value>`** | ✅ 采纳 |
| `Authorization: Bearer ...`（与用户 token 共用） | ❌ |
| Query string | ❌ |

**理由**：
- 不占用 `Authorization`，用户 token 仍走 Bearer，两个鉴权维度物理分离
- Network 面板 / curl `-i` 一眼可见，调试友好
- 不进 URL，不会泄露到 access log

### D4. 轮转策略 — **不设有效期 + 手动轮转 + 两通道分开**

- **不设有效期**：token 不带 `exp` claim，不引入定时任务复杂度
- **手动轮转**：发现疑似泄露 / 运维人员变更 / 重大事件后手动改两端值
- **两通道分开**：`INTERNAL_TOKEN`（server ↔ api）与未来的 `UNLIM_INTERNAL_TOKEN`（unlim-worker 通道）**独立**，互不复用，防止低风险通道泄露向高风险通道升级

**理由**：当前威胁模型下，定期轮转的边际收益低于运维负担。手动轮转 + 两通道隔离已足够覆盖主要攻击面。如果将来接入第三方 audit / 合规要求，再升级为带 `exp` 的 JWT（与 D1 决策共同重审）。

## Token 清单

| Token 名 | 持有方 | 验证方 | 用途 |
|---|---|---|---|
| `INTERNAL_TOKEN` | apps/server | apps/api（前身 mock-server） | 所有 `/api/*` 代理请求 |
| `ADMIN_TOKEN` | 运维 | apps/api | 后台管理（已有，BE-131 已在 apps/server 同步） |
| `UNLIM_INTERNAL_TOKEN` | （未定） | unlim-worker | **不在本 ADR 范围**，待 Phase 3 真接通 unlim-worker 时另起 ADR |

## 后果

### 直接锁定的工作（Phase 2 全部 9 项）

详见 [`docs/sprint/2026-05-14-edge-layer.md`](../../sprint/2026-05-14-edge-layer.md)。

核心耦合对：
- **BE-135**：apps/server `mock-fallback.ts` 出向注入 `X-Internal-Token`
- **BE-142**：apps/api 新增 `middleware/internal-token.ts` 校验

这两个必须**同 PR 合并**或 **BE-142 先合 BE-135 后合**，否则边缘签了但后端不验等于没签，反之后端验但边缘不签等于把自己锁外面。

### 应急 SOP（运维必读）

发现 INTERNAL_TOKEN 泄露：

1. 生成新 token：`openssl rand -hex 32`
2. Cloudflare Dashboard → 改 Worker Secret `INTERNAL_TOKEN`
3. 改服务器 `.env` 里的 `INTERNAL_TOKEN`，重启 `apps/api` 容器（`docker compose restart api`）
4. **目标 1 小时内完成全链路切换**（D4 议过的应急时长）
5. 同时检查 access log，确认是否有可疑请求来自非 Worker 来源

### 不在本 ADR 范围

- 用户 token（Authorization Bearer）的设计 → 看 ADR-0005 / 待后续 ADR
- UNLIM_INTERNAL_TOKEN → Phase 3 接通 unlim-worker 时再议
- token 自动轮转 / JWT 升级 → 当前威胁模型下不需要，未来合规要求时重审

## 相关

- [ADR-0007](0007-linked-server-mock-fallback.md)：本地联动 fallback（本 ADR 决定其生产化的鉴权机制）
- [ADR-0008](0008-deployment-shape-decision.md)：上线形态决策（本 ADR 是它的具体子决策）
- [接口审计与TODO.md](../../../接口审计与TODO.md) §五：Phase 2 工单全清单
- [docs/sprint/2026-05-14-edge-layer.md](../../sprint/2026-05-14-edge-layer.md)：Phase 2 dev-facing 工单
