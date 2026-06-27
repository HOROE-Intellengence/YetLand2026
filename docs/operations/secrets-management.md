# Secrets 管理 SOP

> ADR-0009 D2 落地 — Worker 端与 Node 端的 INTERNAL_TOKEN 及其他 secret 的标准操作流程。

## Token 清单

| Token | 持有方 | 验证方 | 来源 | 轮转触发 |
|---|---|---|---|---|
| INTERNAL_TOKEN | Worker secrets | Node `.env` | `openssl rand -hex 32` | 人员离职 / 疑似泄露 |
| ADMIN_TOKEN | Worker secrets + Node `.env` | Worker + Node | 强随机 32+ 字符 | 同上 |
| ANTHROPIC_API_KEY | Worker + Node | Anthropic API | Anthropic Dashboard | 账单异常 / 配额超 |
| OPENAI_API_KEY | Worker + Node | OpenAI API | OpenAI Dashboard | 同上 |
| DEEPSEEK_API_KEY | Worker + Node | DeepSeek API | DeepSeek Dashboard | 同上 |

## 操作流程

### 添加新 secret

1. 生成值：
   - 共享密钥：`openssl rand -hex 32`
   - API key：从对应提供商 Dashboard 获取
2. Worker 端注入：
   ```bash
   wrangler secret put <NAME>
   ```
   或通过 Cloudflare Dashboard → Workers → yelan-server → Settings → Variables → Secrets
3. Node 端注入：编辑服务器 `.env`，追加 `<NAME>=<value>`
4. Docker 重启：`docker compose restart api`
5. 在本文档"Token 清单"表格加一行
6. 更新 `infra/deploy/.env.example` 加占位说明
7. 写入 CHANGELOG（如有）

### 轮转现有 secret

1. 生成新值（同"添加新 secret"步骤 1）
2. **先 Worker，后 Node**（Worker 签 token → Node 验签 场景）：
   ```bash
   wrangler secret put INTERNAL_TOKEN  # 先更新 Worker 端
   ssh prod "sed -i 's/^INTERNAL_TOKEN=.*/INTERNAL_TOKEN=<new>/' /path/to/.env"
   ssh prod "docker compose restart api"
   ```
3. 轮转后验证（见下方"验证命令"）
4. 旧值在所有持有方都更新后 invalidate（API key 场景：在提供商 Dashboard 吊销旧 key）

### 应急（疑似泄露）

按 ADR-0009 §应急 SOP：

1. **确认泄露**：检查 error.log 是否有异常 INTERNAL_TOKEN_INVALID / INTERNAL_TOKEN_MISSING 日志
2. **生成新 token**：`openssl rand -hex 32`
3. **同时更新两端**（打破常规"先 Worker 后 Node"顺序——应急场景先关闸）：
   ```bash
   # 先更新 Node 端（拦截所有无 token 请求）
   ssh prod "sed -i 's/^INTERNAL_TOKEN=.*/INTERNAL_TOKEN=<emergency>/' /path/to/.env"
   ssh prod "docker compose restart api"
   # 再更新 Worker 端（恢复合法流量）
   wrangler secret put INTERNAL_TOKEN
   ```
4. **验证**：跑验证命令
5. **通报**：ops 频道公告轮转完成
6. **事后**：排查泄露途径，更新本文档

**目标**：从发现泄露到轮转完成 **1 小时内**。

## 验证命令

```bash
# Worker → Node 端到端（应 200）
curl -i https://api.example.com/api/health
# 期望：200 + JSON body

# 直连 Node 后端（绕过 Worker，应 401）
curl -i https://api-internal.example.com/api/health
# 期望：401 + {"code":"INTERNAL_TOKEN_MISSING"}

# 直连 + 错 token（应 401）
curl -i -H 'X-Internal-Token: wrong' https://api-internal.example.com/api/health
# 期望：401 + {"code":"INTERNAL_TOKEN_INVALID"}

# Worker 端 secrets 列表
wrangler secret list --name yelan-server
# 期望：含 INTERNAL_TOKEN, ADMIN_TOKEN

# Node 端 env 检查
docker compose exec api env | grep INTERNAL_TOKEN
# 期望：INTERNAL_TOKEN=<value> + INTERNAL_TOKEN_REQUIRED=true
```

## 权限矩阵

| Secret | 可读写 | 只读 | 备注 |
|---|---|---|---|
| INTERNAL_TOKEN | 架构 lead + 运维 lead | — | 至少 2 人，互为备份 |
| ADMIN_TOKEN | 架构 lead + 运维 lead | 后端开发 | — |
| LLM API Keys | 架构 lead + 财务 | 运维 lead | 计费责任 |

**规则**：
- 任何 secret 变更需在 ops 频道公告（至少一条消息记录 what / why / when）
- 生产 secret 不得出现在 Git 历史、PR 描述、Slack 截图、本地 `.env` 备份中
- `wrangler secret put` 的值不会回显，输完即忘

## 关联文档

- [ADR-0009 — INTERNAL_TOKEN 设计](../tech/adr/0009-internal-token-design.md)
- [INFRA-104 — wrangler.toml + .env 配 INTERNAL_TOKEN](../sprint/2026-05-14-edge-layer.md#infra-104--wranglertoml--env-配-internal_token)
- [灰度测试检查表](../gray-test-checklist.md)
