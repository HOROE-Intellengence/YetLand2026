# 夜阑 灰测卫生包执行手册

版本：V0.77.514.14 | 最后更新：2026-06-19（+九、移动端专项）

---

## 一、启动前检查

### 1.1 依赖安装

```powershell
pnpm install --frozen-lockfile
```

### 1.2 门禁验证

```powershell
pnpm verify:gray
```

期望输出：
- `lint`: apps/server Done, apps/web Done
- `typecheck`: 5 个包全部 Done
- `test:gray`: 18 tests passed
- `contracts:check`: CI PASSED (0 errors)

若失败，禁止继续部署。

### 1.3 环境变量确认

检查根 `.env`（或 Docker 环境变量）：

| 变量 | 要求 | 说明 |
|------|------|------|
| `ADMIN_TOKEN` | **非默认** `admin-dev-token` | 生产必须修改 |
| `CORS_ORIGINS` | 真实域名 | 如 `https://gray.example.com` |
| `FEATURE_REAL_LLM` | `on` 或 `off` | 灰测初期建议 `off` |
| `DEPLOY_MODE` | `server` | Docker 部署自动设 |
| LLM Key | 任一有效 | `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `DEEPSEEK_API_KEY` |

若 `FEATURE_REAL_LLM=off`，无需 LLM key。

### 1.4 快照

```powershell
pnpm gray:snapshot
```

确认 `apps/api/.local/snapshots/snapshot-*.json` 已生成。

---

## 二、启动

### 2.1 本地

```powershell
pnpm start:full
```

自动启动 apps/api (port 8787) + web (port 5173)。

### 2.2 服务器（Docker + Caddy）

```powershell
pnpm deploy:up
```

检查容器状态：

```powershell
pnpm deploy:ps
```

期望：`mock` 和 `caddy` 两个容器均为 `Up`。

---

## 三、验证清单

按顺序执行，任一步失败即中止。

### 3.1 /health

```powershell
curl http://localhost:8787/health
```

期望：`{"ok":true,"name":"yelan-api","deploy":{...},"llm":{...},"sidecar":{...}}`

### 3.2 /admin 控制台

浏览器打开 `http://localhost:8787/admin`（或真实域名 `/admin`）。

- 使用 `ADMIN_TOKEN` 登录（默认 `admin-dev-token`，仅本机可用）。
- 确认控制台首页加载，无空白页。

### 3.3 Seed 数据

在控制台 #setup 页点击"快速 Seed"，或：

```powershell
pnpm seed
```

确认返回 `{"ok":true, ...}` 且 `users` 数组有 3 个用户。

### 3.4 角色选择 → 发一轮对话

1. 浏览器打开前端首页。
2. 首页 → 选择问候语或"直接进入"。
3. 角色选择页 → 点击角色卡 → 进入对话。
4. 输入消息 → 点击发送。
5. 确认：
   - SSE 流式返回文本可见。
   - TypingDots 出现并消失。
   - 无控制台报错（红色错误）。
   - 无空白渲染。

### 3.5 审计日志

控制台 #audit 页 → 确认有 seed 和对话相关记录。

若为空，检查 `ADMIN_TOKEN` 是否正确传入。

### 3.6 额度 / 烛账

控制台 #quota 页 → 确认今日额度行存在。

控制台 #candle 页 → 确认种子用户有烛账流水。

### 3.7 抽屉面板

对话页 → 点击右侧导航条各入口：
- 你 / 续夜 / 烛账 / 书阁 / 记事 / 印 / 一问 / 调息

每个面板应展示内容（非空白），未开放功能显示"灰测暂未开放"。

### 3.8 Survey 反馈

一问面板 → 输入反馈 → 提交 → 确认 `POST /api/events` 收到 `type:user_feedback`。

---

## 四、SSE 部署检查

### 4.1 真实域名 SSE 连通

```powershell
curl -X POST https://<your-domain>/api/chat \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -H "Authorization: Bearer <user-token>" \
  -d '{"characterId":"<id>","sessionId":"test","round":0,"prevStage":"daily","userBoundary":2,"text":"你好","history":[]}'
```

确认返回以 `data:` 开头的 SSE 事件流。

### 4.2 Caddy flush_interval

确认 `infra/deploy/Caddyfile` 中反向代理 `/api/*` 段落包含 `flush_interval -1`：

```
reverse_proxy /api/* mock:8787 {
    flush_interval -1
}
```

若缺失，SSE 消息将被缓冲，用户看到延迟/卡顿。

---

## 五、中止判据

以下任一触发即为中止，立即通知开发部：

| 判据 | 检测方式 |
|------|---------|
| SSE 失败率 > 10% | `/api/events` 中 `sse_error` 事件比例 |
| 连续 5xx 出现 | `/api/admin/health` 或 Caddy 日志 |
| 成本硬闸触发 | `/api/admin/costs` 全局 token 超限 |
| 隐私/合规反馈 | Survey 反馈中含敏感关键词 |
| requestId 不可追踪 | 错误日志中 requestId 缺失或重复 |

---

## 六、成功判据

| 判据 | 指标 |
|------|------|
| 目标用户完成 happy path | 首页 → 选角 → 一轮对话 |
| verify:gray 全绿 | lint + typecheck + 18 tests + contracts |
| 反馈可回收 | `/api/events` 收到 user_feedback |
| 无未知 5xx | error.log 中仅预期错误（如 CHARACTER_NOT_FOUND） |
| 无成本异常 | 成本看板 token 消耗在预期范围内 |

---

## 七、回滚

### 7.1 快照恢复

```powershell
pnpm gray:reset
```

若提示无 baseline，先手动创建：

```powershell
copy apps\api\.local\state.json apps\api\.local\state.baseline.json
```

### 7.2 Docker 日志

```powershell
pnpm deploy:logs
```

### 7.3 重启

```powershell
pnpm deploy:down
pnpm deploy:up
```

### 7.4 完全清理重建

```powershell
pnpm deploy:down
Remove-Item -Force apps\api\.local\state.json
pnpm seed
```

---

## 八、requestId 追踪

每次请求的 `x-request-id` 响应头 + 错误 JSON 中的 `requestId` 字段，可链式追踪：

1. 浏览器 DevTools → Network → 任意 `/api/*` 请求 → Response Headers → `x-request-id`。
2. 错误响应 JSON 中 `.requestId`。
3. 服务器 `apps/api/.local/logs/error.log` 中同字段。

```powershell
# 按 requestId 查错误日志
Select-String -Path "apps\api\.local\logs\error.log" -Pattern "req_abc123"
```

---

## 九、移动端专项

> 对应《[移动端适配长期方案](移动端适配长期方案.md)》Phase 0–5 的真机验收口径。
> CI（typecheck/test/build/lint）只能守住代码正确性；以下多数项**必须真机过**——桌面 Chrome 的 mobile preset 只改尺寸、不翻 `pointer:coarse`、不弹软键盘、无刘海 inset。
> 矩阵：至少 1 台 iPhone（含刘海/灵动岛）+ 1 台主流安卓；每台过竖屏 + 横屏 + 深色/浅色。

### 9.1 PWA standalone（Phase 1）

- [ ] iOS Safari「添加到主屏」后启动：**无地址栏**、有图标、启动主题色 `#0a0a0f`。
- [ ] 移动 Chrome 出现「添加到主屏幕」原生提示；添加后独立窗口运行。
- [ ] 桌面 DevTools → Application → Manifest：无报错，3 个图标（192/512/maskable）+ apple-touch 均可加载。
- [ ] 图标为**占位月牙**（金色），换正式品牌图标后覆盖 `apps/web/public/icons/*` + `apple-touch-icon.png` 重测。
  > 注：Lighthouse 12+ 已移除 PWA 类目，可安装性**不**以其评分为准。

### 9.2 安全区 + 动态视口（Phase 1）

- [ ] 刘海/灵动岛机型：对话页返回键、温度徽标、输入框**不被遮挡**；横屏右缘凹口下抽屉/关闭键不被切。
- [ ] 滚动时地址栏收起/展开，底部输入框**不被地址栏顶掉**（`100svh` 渐进增强生效；旧机回落 `100vh` 仍可用）。

### 9.3 软键盘 + 输入人体工学（Phase 2）

- [ ] 聚焦输入框：软键盘弹出后，输入框**抬到键盘之上**，最新消息可见（`--keyboard-inset` 生效）。
- [ ] 多行输入：textarea 随内容增高到约 5 行后内部滚动；发送后复位单行。
- [ ] 弹/收键盘、发送，全程无跳动、无最新消息被盖。
- [ ] iOS 聚焦任意输入框（对话/登录/取名/面板）**不触发自动缩放**（16px 地板生效）。

### 9.4 触摸目标（Phase 2/4）

- [ ] 返回键 / 发送键 / 抽屉导航项 / 关闭键单指可稳点（命中区 ≥44×44）。
- [ ] 触屏上 hover 效果**不粘连**（hover 已包进 `@media (hover: hover)`，按压走 `:active`）。

### 9.5 流式 / 内在布局（Phase 3）

- [ ] 320→1920px 连续拖动（或多机型）：阅读栏**连续无断裂**，横竖屏切换无错位。
- [ ] 大号字（标题等）随屏流式缩放；正文 md/sm **稳定不缩**（叙事可读性）。
- [ ] 抽屉面板按**自身宽度** reflow（窄抽屉下 statGrid/卡头堆叠为单列）。
  > 已知：桌面对话阅读列文字宽由 512→560（内在宽度模型直接后果）。

### 9.6 手势化导航（Phase 4）

- [ ] 手机上从**右缘滑入**流畅唤出导航；存在至少一个**可见入口**（`≡` 单按钮）。
- [ ] 点单入口展开 8 项；选项打开对应抽屉并收起。
- [ ] 抽屉在小屏（≤480px）转**全宽 sheet**；安全区不被切。
- [ ] 桌面 rail 行为**不变**（8 按钮常显、无单入口）。

### 9.7 动效 / 性能降级（Phase 5）

- [ ] 开启系统「减少动态效果」：对话页动画退化为**纯淡入**（无 blur 位移），`<html>` 标记 `data-motion="reduced"`。
- [ ] 低端机/CPU 节流下滚动与流式输出不明显掉帧。
  > 阻塞项：**粒子预算降级**待 ParticleField canvas 实装后再做（当前为 stub）。

### 9.8 token 护栏（Phase 0/6）

- [ ] `pnpm --filter @yelan/design-tokens run test` 绿——`sizes/proseWidth/stageLayout` 基础值未被改成 `vw`/`clamp`。
- [ ] share / 长图导出实装后，补像素级视觉对比（当前未实装）。

### 9.9 过场页巡检（Phase 6）

- [ ] Intro / Opening / Name / Login / NarrativeCutoff 在 md(768) 断点下逐一过，无溢出/错位/不可点。
