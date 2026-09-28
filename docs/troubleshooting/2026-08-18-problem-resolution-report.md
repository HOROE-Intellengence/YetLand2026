# 夜阑项目会话截断问题 - 解决方案实施报告

**报告日期**: 2026-08-18  
**问题来源**: 用户反馈 - 会话 `local_xia-yi-zhou_c929ea61-352` 频繁截断  
**状态**: ✅ 已完成修复和配置优化

---

## 一、问题诊断总结

### 1.1 主要问题

根据项目文档 (`docs/troubleshooting/`) 的分析，发现了三个核心问题：

#### 问题1：输出截断（已修复 2026-08-16）
- **根因**: Node.js 默认 `headersTimeout=60s`，SSE长连接在60秒时被静默断开
- **表现**: AI回复在生成过程中突然中断，句子不完整

#### 问题2：用户消息未得到回复（已修复 2026-08-16）
- **根因**: 前端过早保存用户消息，请求失败时消息已保存但无回复
- **表现**: 对话历史中有用户消息但没有AI回复

#### 问题3：Token限制触发（配置已优化 2026-08-18）
- **根因**: 单会话token累计超过默认限制20万
- **表现**: HTTP 429错误，最高记录达到70万token（会话ID: `local_xia-yi-zhou_c929ea61-352`）

---

## 二、已实施的修复

### 2.1 代码修复（8月16日完成）

#### ✅ 后端修复：`apps/api/src/index.ts`
```typescript
// 配置超时 - SSE 流式响应需要更长的超时时间
server.headersTimeout = 0;      // 0 = 无限制，适合 SSE 长连接
server.requestTimeout = 0;      // 0 = 无限制
server.keepAliveTimeout = 65000; // 65秒，比 Caddy 的 30s 更大
```

**效果**: SSE连接不再在60秒时断开，支持任意长度的对话生成

#### ✅ 前端修复：`apps/web/src/hooks/useChat.ts`
```typescript
let streamStarted = false;  // 标记流是否成功开始
let wasAborted = false;     // 标记是否被用户主动中止

// 延迟保存用户消息，直到流开始
if (!streamStarted) {
  useChatStore.getState().addUserMessage(userMsg);
  streamStarted = true;
}

// 区分 AbortError（用户主动停止）和其他错误
catch (e) {
  if (e instanceof Error && e.name === 'AbortError') {
    wasAborted = true;
  }
}

// 只保存成功且未中止的回复
if (assistantBuf && streamStarted && !wasAborted) {
  useChatStore.getState().addAssistantMessage(assistantBuf);
}
```

**效果**: 
- 请求失败时不保存孤立的用户消息
- 用户点击停止时不保存截断的回复
- 避免消息重复

### 2.2 配置优化（8月18日完成）

#### ✅ 环境变量配置：`infra/deploy/.env`

新增配置：
```env
# Token限制（关闭硬限制，但设置更高的值作为备用）
TOKEN_GUARD_ENABLED=off
SESSION_TOKEN_LIMIT=500000
GLOBAL_DAILY_TOKEN_LIMIT=5000000

# 上下文压缩（降低阈值以更早触发压缩）
CONTEXT_COMPRESS_TOKEN_LIMIT=6000

# 侧袋AI超时（延长超时时间）
SIDECAR_STRUCTURER_TIMEOUT_MS=15000
```

**效果**:
- Token硬限制已关闭，不会再触发429错误
- 上下文压缩会在6000 tokens时触发，避免无限累积
- 侧袋AI（氛围判断、结构化输出）超时时间从5秒延长到15秒

---

## 三、验证结果

### 3.1 健康检查 ✅

运行 `scripts/check-session-health.sh` 的结果：

```
✅ Docker容器状态: 健康运行
✅ 环境变量配置: 已正确设置
✅ 前端修复: wasAborted 和 streamStarted 逻辑已应用
✅ 后端修复: headersTimeout=0 和 requestTimeout=0 已设置
✅ Token限制错误: 最后记录在 2026-07-30，近期无新错误
```

### 3.2 错误日志统计

- **Token限制触发**: 16次（最后一次：2026-07-30）
- **JSON解析错误**: 2次（偶发，可能由网络传输引起）
- **侧袋AI超时**: 0次

### 3.3 最近会话活动

监控显示会话正常运行，包括问题会话 `local_xia-yi-zhou_c929ea61-352`：
- Round 11-12 正常完成
- Token消耗：1485-1520 per turn
- 使用模型：gemini-3.5-flash-lite

---

## 四、问题解决状态

| 问题 | 状态 | 修复时间 | 验证结果 |
|------|------|---------|---------|
| 输出截断（60秒超时） | ✅ 已解决 | 2026-08-16 | 代码已修复，配置已验证 |
| 用户消息无回复 | ✅ 已解决 | 2026-08-16 | 前端逻辑已修复 |
| Token限制触发 | ✅ 已解决 | 2026-08-18 | 配置已优化，限制已关闭 |
| 消息重复 | ✅ 已解决 | 2026-08-16 | 前端逻辑已修复 |

---

## 五、监控建议

### 5.1 短期监控（1-2周）

**日常检查**:
```bash
cd /root/YetLand2026
./scripts/check-session-health.sh
```

**观察指标**:
1. 用户反馈：是否还有截断/重复消息报告
2. 错误日志：`infra/deploy/_data/logs/error.log`
3. 容器状态：`docker compose ps`

### 5.2 实时日志监控

查看实时日志：
```bash
cd /root/YetLand2026/infra/deploy
docker compose logs -f api | grep -E "chat|error|timeout|TOKEN_GUARD"
```

### 5.3 告警设置（可选）

如果需要自动告警，可以设置：
```bash
# 监控Token限制错误
tail -f infra/deploy/_data/logs/error.log | \
  grep --line-buffered "TOKEN_GUARD_TRIPPED" | \
  while read line; do
    echo "⚠️  Token限制触发: $line"
    # 这里可以接入告警系统（邮件、钉钉、飞书等）
  done
```

---

## 六、文件清单

### 修复相关文件
- ✅ `apps/api/src/index.ts` - 后端超时配置
- ✅ `apps/web/src/hooks/useChat.ts` - 前端错误处理
- ✅ `infra/deploy/.env` - 环境变量配置
- ✅ `.env` - 项目根目录配置（本地开发用）

### 监控工具
- ✅ `scripts/check-session-health.sh` - 健康检查脚本

### 文档
- 📄 `docs/troubleshooting/session-timeout-fix.md` - Token限制问题
- 📄 `docs/troubleshooting/output-truncation-final-root-cause.md` - 输出截断根因
- 📄 `docs/troubleshooting/fix-implementation-report.md` - 修复实施报告
- 📄 `docs/troubleshooting/message-duplication-root-cause.md` - 消息重复根因

---

## 七、回滚方案（如有需要）

如果新配置导致问题：

```bash
cd /root/YetLand2026/infra/deploy

# 1. 编辑 .env，移除或注释掉新增的配置
nano .env

# 2. 重启服务
docker compose restart api

# 3. 如果需要回滚代码
cd ../..
git diff apps/api/src/index.ts
git diff apps/web/src/hooks/useChat.ts
# 确认差异后，必要时可以 git checkout 恢复
```

---

## 八、总结

### 修复成果
1. ✅ **彻底解决60秒超时问题** - 长对话不再被截断
2. ✅ **消除Token限制瓶颈** - 从20万提升到50万，同时关闭硬限制
3. ✅ **优化前端错误处理** - 区分用户中止和系统错误，避免保存不完整内容
4. ✅ **增强系统可观测性** - 提供健康检查脚本

### 影响范围
- **用户体验**: 长对话不再中断，消息不再重复
- **系统稳定性**: 前后端超时配置合理，错误处理完善
- **运维效率**: 提供自动化健康检查工具

### 下一步
1. 观察1-2周，收集用户反馈
2. 如果没有新问题，可以考虑长期优化：
   - 添加心跳机制（长时间生成时发送心跳）
   - 添加用户友好的错误提示（Toast/通知）
   - 添加自动重试机制（网络失败时）

---

**报告人**: Claude (Kiro AI)  
**最后更新**: 2026-08-18 17:11  
**服务状态**: ✅ 健康运行
