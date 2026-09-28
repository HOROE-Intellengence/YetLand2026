# 夜阑项目 - 会话超时与输出截断问题诊断报告

**日期**: 2026-08-16  
**问题**: 频繁的会话超时、输出截断、不输出问题

## 问题分析

### 1. **核心问题：Session Token 限制触发**

**错误日志证据**（来自 `infra/deploy/_data/logs/error.log`）：
```
{"ts":"2026-07-21T18:12:47.140Z","code":"TOKEN_GUARD_TRIPPED","message":"session_token_limit: 219621/200000"}
{"ts":"2026-07-21T18:13:13.054Z","code":"TOKEN_GUARD_TRIPPED","message":"session_token_limit: 247737/200000"}
{"ts":"2026-07-21T18:13:45.502Z","code":"TOKEN_GUARD_TRIPPED","message":"session_token_limit: 297570/200000"}
{"ts":"2026-07-30T07:10:50.035Z","code":"TOKEN_GUARD_TRIPPED","message":"session_token_limit: 223726/200000"}
```

**根本原因**：
- 单个会话累计token超过了硬限制 **200,000 tokens**
- Token守护机制触发，返回 HTTP 429 错误
- 用户看到的表现是：请求被拒绝、输出中断、会话卡住

**代码位置**：`apps/api/src/services/token-guard.ts`
```typescript
const SESSION_TOKEN_LIMIT = Number(process.env.SESSION_TOKEN_LIMIT) || 200_000;
```

### 2. **次要问题：侧袋AI超时**

**超时配置**：
- 默认侧袋超时：5秒（`SIDECAR_DEFAULT_TIMEOUT_MS = 5000`）
- 输出结构化超时：8秒（`OUTPUT_STRUCTURER_TIMEOUT_MS = 8000`）

在长对话、复杂场景中，侧袋AI（氛围判断、输出结构化等）可能超时导致降级。

### 3. **JSON解析错误**

日志显示偶发的 `Malformed JSON in request body` 错误，可能由网络传输截断或客户端序列化问题引起。

## 解决方案

### 方案 A：提高Token限制（快速修复）

**适用场景**：角色扮演、长对话场景需要保持更长的上下文

**操作步骤**：

1. 在根目录创建或编辑 `.env` 文件：
```bash
cd /root/YetLand2026
nano .env
```

2. 添加或修改以下环境变量：
```env
# 将单会话token限制从20万提升到50万
SESSION_TOKEN_LIMIT=500000

# 全局每日token限制（可选，根据成本调整）
GLOBAL_DAILY_TOKEN_LIMIT=5000000

# 延长侧袋AI超时时间（毫秒）
SIDECAR_STRUCTURER_TIMEOUT_MS=15000
```

3. 重启服务：
```bash
# 如果是本地开发
pnpm dev

# 如果是Docker部署
cd infra/deploy
docker compose restart
```

### 方案 B：启用上下文压缩（推荐长期方案）

**原理**：当对话历史超过阈值时，自动压缩旧消息，保持token在限制内。

**操作步骤**：

1. 通过运营后台调整压缩策略：
   - 访问 `http://127.0.0.1:8787/admin`（本地）或 `https://your-domain.com/admin`（生产）
   - 进入 **配置 → 策略** 面板
   - 找到 `CONTEXT_COMPRESS_TOKEN_LIMIT`（上下文压缩阈值）
   - 当前默认值：8000 tokens
   - 建议调整为：**6000-8000 tokens**（更激进的压缩）

2. 或者通过环境变量直接修改 `.env`：
```env
# 在对话历史达到6000 tokens时就触发压缩
CONTEXT_COMPRESS_TOKEN_LIMIT=6000
```

3. 验证上下文压缩是否生效：
```bash
# 查看日志中是否有压缩记录
cd /root/YetLand2026
tail -f infra/deploy/_data/logs/error.log | grep -i compress
```

### 方案 C：完全关闭Token Guard（仅测试用）

⚠️ **警告**：此方案会移除成本控制，仅用于诊断问题是否由token限制引起。

```env
# 关闭token硬闸
TOKEN_GUARD_ENABLED=off
```

### 方案 D：手动清理会话

当特定会话累计token过多时，可以：

1. **前端操作**：引导用户开启新会话（清除历史）
2. **后台操作**：通过运营后台删除问题会话的历史记录
   - 访问 `http://127.0.0.1:8787/admin` → **用户 → 会话**
   - 找到累计token过高的会话
   - 删除或归档

3. **直接修改状态文件**（高级）：
```bash
# 备份当前状态
cd /root/YetLand2026/apps/api/.local
cp state.json state.json.backup

# 编辑state.json，找到并删除sessions中累计token过多的会话
nano state.json
```

## 监控与预防

### 1. 实时监控Token使用

在运营后台查看：
- **监控 → 总览**：查看全局token使用统计
- **监控 → 成本统计**：按用户、会话查看token消耗

### 2. 设置合理的限制

建议配置（根据业务调整）：

| 场景 | SESSION_TOKEN_LIMIT | CONTEXT_COMPRESS_TOKEN_LIMIT |
|------|---------------------|------------------------------|
| 短对话场景 | 100,000 | 5,000 |
| 中等对话 | 200,000（默认） | 8,000（默认） |
| **角色扮演长对话** | **500,000** | **10,000** |
| 无限制测试 | 2,000,000 | 50,000 |

### 3. 日志告警

监控 `error.log` 中的 `TOKEN_GUARD_TRIPPED` 事件：

```bash
# 统计今日触发次数
grep TOKEN_GUARD_TRIPPED /root/YetLand2026/infra/deploy/_data/logs/error.log | wc -l

# 查看哪些用户频繁触发
grep TOKEN_GUARD_TRIPPED /root/YetLand2026/infra/deploy/_data/logs/error.log | grep -o '"userId":"[^"]*"' | sort | uniq -c | sort -rn
```

## 快速验证

重启服务后，测试是否解决：

```bash
# 1. 检查环境变量是否生效
cd /root/YetLand2026
pnpm dev

# 查看启动日志，确认SESSION_TOKEN_LIMIT已更新

# 2. 发起对话测试
# 访问前端，进行长对话测试

# 3. 检查错误日志
tail -f infra/deploy/_data/logs/error.log
# 应该不再出现 TOKEN_GUARD_TRIPPED 错误
```

## 相关文件

- Token限制配置：`apps/api/src/services/token-guard.ts`
- 策略定义：`apps/api/src/services/policy-definitions.ts`
- 上下文压缩：`apps/api/src/sidecar-ai/context-compressor.ts`
- 侧袋超时配置：`apps/api/src/sidecar-ai/client.ts`
- 聊天路由：`apps/api/src/routes/chat.ts`
- 聊天管道：`apps/api/src/pipeline/chat-pipeline.ts`

## 下一步

1. **立即执行**：方案A（提高token限制）+ 方案B（降低压缩阈值）
2. **监控观察**：运行24小时，观察error.log中是否还有TOKEN_GUARD_TRIPPED
3. **优化调整**：根据实际使用情况微调参数
4. **用户通知**：如果问题由长对话引起，考虑在前端添加"token使用提示"

## 紧急回滚

如果调整后出现新问题：

```bash
# 恢复默认配置
cd /root/YetLand2026
rm .env  # 或删除添加的自定义变量

# 重启服务
docker compose restart  # 或 pnpm dev
```
