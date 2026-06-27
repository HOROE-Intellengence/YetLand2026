# Spec — 可视化后台「配置重载」按钮（BE-142）

> 类型：Spec（实施细则）。决策见末尾「背景」；本文只讲改哪个文件、代码骨架、验收命令。

## 背景

体检发现：主聊天恒走脚本化 mock 流，根因是 `FEATURE_REAL_LLM` 未开。
连带暴露两个结构问题：

1. `apps/api/src/config/feature-flags.ts` 的 `flagCache` 无失效机制 —— 运行中改
   env 不生效，必须重启进程。
2. 改 `.env` / 加 API key 后，唯一生效手段是重启 `apps/api`。

决策（用户拍板）：给可视化后台（`apps/admin`）加一个**配置重载**按钮。
明确**不做**进程重启（进程无法可靠自我重启）—— 只做「重新读配置」。

`apps/api/src/llm/router.ts` 已有 `resetRouter()`，零件齐备。

## 目标

后台「一键向导」（Setup）页「快捷操作」区出现一个按钮，点一下：

1. 重新解析 `.env` 文件 → 灌入 `process.env`
2. 清空 feature-flag 缓存
3. 重建 LLM router（`resetRouter()`）
4. 返回**变更清单**（哪些 flag 翻转、router 重建后几个 provider ready），
   前端 toast 显示

不重启进程、不断正在进行的 SSE 连接。

## 改动清单

### 文件 1：`apps/api/src/config/feature-flags.ts`

新增一个导出，清空缓存：

```ts
/** 清空 flag 缓存 —— 配置重载后调用，让下次 flag() 重新读 process.env */
export function clearFlagCache(): void {
  flagCache.clear();
}
```

不动 `readFlag` / `flag` / `flagOr` 的现有行为。

### 文件 2：`apps/api/src/routes/admin/diagnostics.ts`

复用文件内已有的 `parseEnvFile()` / `ENV_ROOT` / `ENV_APP`。新增接口：

```ts
import { clearFlagCache, FEATURE_FLAGS, flag } from '../../config/feature-flags';
import { resetRouter, getRouter } from '../../llm/router';

/** 配置重载 —— 重新读 .env + 清 flag 缓存 + 重建 router，不重启进程 */
adminDiagnosticsRoute.post('/reload-config', (c) => {
  // 1. 重载前快照（flag 值）
  const before: Record<string, boolean> = {};
  for (const f of Object.values(FEATURE_FLAGS)) before[f] = flag(f);

  // 2. 重新解析 .env → process.env（app 覆盖 root）
  //    实施前先看 bootstrap-env 的加载顺序，本行须与其一致；当前环境 apps/api/.env
  //    不存在，实际只有 root .env 生效。
  const merged = { ...parseEnvFile(ENV_ROOT), ...parseEnvFile(ENV_APP) };
  let envApplied = 0;
  for (const [k, v] of Object.entries(merged)) {
    if (process.env[k] !== v) { process.env[k] = v; envApplied++; }
  }

  // 3. 清 flag 缓存 + 重建 router
  clearFlagCache();
  resetRouter();

  // 4. 重载后快照 + 算 diff
  const after: Record<string, boolean> = {};
  for (const f of Object.values(FEATURE_FLAGS)) after[f] = flag(f);
  const flagChanges = Object.keys(after)
    .filter((f) => before[f] !== after[f])
    .map((f) => ({ flag: f, from: before[f], to: after[f] }));

  const router = getRouter();
  const readyProviders = Array.from(router.providers.entries())
    .filter(([, p]) => p.ready).map(([n]) => n);

  return c.json({
    ok: true,
    envApplied,
    flagChanges,
    readyProviders,
    ts: new Date().toISOString(),
  });
});
```

并在文件末尾的 `quickActions` 数组加一项：

```ts
{ id: 'reload-config', label: '重载配置', method: 'POST', path: '/api/admin/diagnostics/reload-config' },
```

### 文件 3：`apps/admin/src/routes/Setup.tsx`

`quickActions` 已被自动渲染为按钮，**功能上零改动即可用**。仅两处体验微调：

1. 图标三元式加一个分支：`action.id === 'reload-config'` → `<RefreshCw size={14} />`
   （`RefreshCw` 已 import）。
2. `runAction` 成功时，若返回体含 `flagChanges`，toast 文案带上变更摘要，例如
   `重载配置 已完成 · FEATURE_REAL_LLM off→on · 1 provider ready`。
   无变更则显示 `重载配置 已完成 · 无变更`。

## 红线

- ❌ 不做进程重启 / `process.exit()` —— 本工单只做配置重载。
- ❌ 不动 `feature-flags.ts` 现有 `flag` / `flagOr` / `readFlag` 行为，只新增 `clearFlagCache`。
- ❌ 不动 `parseEnvFile` 的解析逻辑（复用，不改）。
- ❌ 不碰保留 stub：`apps/server/src/routes/{auth,pay/*,db/*,llm/providers/*}.ts`。
- ✅ `/reload-config` 走 `requireAdmin()`（挂在 `mockAdminRoute` 下自动继承）。

## 验收标准（给后期统一验收机械复跑）

> 状态：静态项实施时已自测通过；运行时项留待统一验收。

| # | 声称 | 验证命令 | 期望 | 当前状态 |
|---|---|---|---|---|
| 1 | clearFlagCache 已加 | `grep -c "clearFlagCache" apps/api/src/config/feature-flags.ts` | ≥ 1 | ✅ 已自测 |
| 2 | 接口 + quickAction 已注册 | `grep -c "reload-config" apps/api/src/routes/admin/diagnostics.ts` | ≥ 2 | ✅ 已自测 |
| 3 | 前端图标 + toast 分支 | `grep -c "reload-config" apps/admin/src/routes/Setup.tsx` | ≥ 2 | ✅ 已自测 |
| 4 | 门禁绿 | `pnpm verify:gray` | `✅ CI PASSED` · Errors 0 | ✅ 已自测 |
| 5 | 接口运行时可调 | `curl -s -X POST http://localhost:8787/api/admin/diagnostics/reload-config -H "Authorization: Bearer admin-dev-token"` | JSON 含 `"ok":true` + `readyProviders` 数组 | ⏳ 待统一验收 |
| 6 | flag 变更可见 | 确保 `.env` 有 `FEATURE_REAL_LLM=on`，先打一次旧 `/api/chat` 看 `llmMode`，调 #5 重载，再打 `/api/chat` | 重载后 SSE meta `llmMode` 由 `mock` → `real`（provider ready 前提下） | ⏳ 待统一验收 |

**BE-142 完成 = 上表 6 条全过。** 当前 1–4 已绿，5–6 待 `apps/api` 启动后统一验收。

## 一段话版本（验毒试纸）

给 `apps/admin` 的「一键向导」页加一个「重载配置」按钮：后端在
`admin/diagnostics.ts` 加 `POST /reload-config` 接口，重新解析 `.env` 灌进
`process.env`、调新增的 `clearFlagCache()` 清 flag 缓存、调已存在的
`resetRouter()` 重建 LLM router，并返回 flag 变更清单；前端因 `quickActions`
自动渲染机制几乎零改动，仅加个刷新图标 + toast 显示变更摘要。**不做进程重启**，
不断 SSE 连接。共 3 文件，验收看 `pnpm verify:gray` + curl `/reload-config`
返回 `ok:true`。
