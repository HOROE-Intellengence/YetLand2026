# 用户账户系统改造 — 审计与复现报告

| 字段 | 值 |
|---|---|
| 分支 | `feat/user-account` |
| 起点 | `main` @ `96eae5e fix(web): restore opening line and account exits` |
| 完成日期 | 2026-05-20（含 codex 审计后 P1 修复） |
| 提交数 | 10（Phase 1-6 + Post-1/2 + P1 修复 + 口径修复） |
| 文件变更（**含全部 commit，对比 main**） | **34 changed, +3360 / −131** |
| 文件变更（仅 user-account 主体 6 个 Phase commit） | 19 changed, +1982 / −74（这是早期摘要的口径） |
| 测试增量 | +51 用例（apps/api：153 → 204；新增 P1 回归 9 个） |
| 全量测试 | apps/api 204/204 绿，apps/server 24/24 绿 |
| typecheck | apps/api / apps/web / apps/server / **packages/shared** 全过 |
| 新增依赖 | **零** |
| stash 状态 | 已 drop（panel polish 已落 user-account，memory-gate 残留已落原分支） |

---

## 1. 范围与边界

### 实现了
- 账户档案扩展：email / nickname / avatarUrl / bio
- 密码登录全套：set / change / login / OTP-reset / lockout / tokenVersion 失效
- 账户管理：改手机号、登出全部设备、注销账户（软删 + 双因素确认）
- 前端 LoginScene + scene 流接入
- apps/server 同名桩（schema 对齐，返回 501 NOT_IMPLEMENTED）

### 明确不在范围
- **匿名号合并真账户**：选了方案 B（匿名留本机，登录切真账户）。Backlog: 烛账/对话历史合并。
- **TOTP / 二要素 / 邮箱验证**：未实现。
- **真实短信网关**：OTP 仍 mock（任意 4-8 位数字通过）。生产路径在 `apps/server/src/services/auth.ts` 中 TODO。
- **30 天硬删**：`deletedAt` 写入即生效，但物理删除作业未实现。Backlog: cron job。
- **tokenIndex GC**：bump 后旧映射保留（让 middleware 报 `AUTH_EXPIRED` 而非 `AUTH_INVALID`），需周期清理。Backlog。
- **avatar 上传**：仅支持 URL 输入；签名/对象存储链路单独 Phase。

---

## 2. 设计抉择（带理由）

| 抉择 | 选择 | 理由 |
|---|---|---|
| 密码哈希算法 | `node:crypto.scrypt(N=16384, r=8, p=1)` | 零外部依赖；NIST 认可；50ms/次符合登录场景 |
| 密码格式 | `scrypt:N=…,r=…,p=…:salt(hex):hash(hex)` | 版本化字符串；将来换参数可无缝升级 |
| 密码强度 | ≥8 位，字母+数字 | 不强求特殊符号（UX），后端 `isStrongPassword` 二次校验 |
| token 失效机制 | 版本号嵌入 token（`tok_v{N}_{uuid}`） | 兼容旧 token（无前缀视为 v0）；不上 JWT 避免污染 chat/memory/preferences |
| 旧 token 是否删除 tokenIndex | **不删** | 保留旧映射 → middleware 能区分 `AUTH_EXPIRED`（版本旧）和 `AUTH_INVALID`（未知 token） |
| softAuth 对过期 token 的处理 | **降级到匿名号**（不报错） | 开门流（OpeningScene→NameScene→CharacterSelect）依赖 softAuth；强校验会破坏首屏 |
| requireAuth 对过期 token | 报 `AUTH_EXPIRED` 401 | 需要"真实身份"的端点必须明确拒绝 |
| `patchUserName` 写 `userProfiles` | **不动** | 它是故意把"用户称呼名"注入 LLM prompt（[chat.ts:95](apps/api/src/routes/chat.ts:95)），不是 bug |
| 新增字段持久化 | 写 user 行，**不**碰 userProfiles | profile 字段不进 LLM context，干净分离 |
| Me 响应 hasPassword | 派生字段 `Boolean(passwordHash)`，永不暴露 hash | 默认安全 |
| 注销账户确认 | 密码或 OTP 任一（无密码者必须 OTP） | 防止误操作 + 兼顾无密码用户 |
| 改手机号 | 不删旧 phoneIndex 残留——等等，**会删**：原子 swap | 防止旧号被复用绑定到 deleted user |
| 匿名号守卫 | hard-code `ANON_PHONE_GUARD = '00000000000'` 在 services 层 | 在最底层拦住，路由层不需要重复检查 |

---

## 3. 文件清单（按 Phase）

### Phase 1 · 字段与契约扩展（507c0a2）
| 文件 | 变更 |
|---|---|
| [packages/shared/src/types/user.ts](packages/shared/src/types/user.ts) | `Me` +7 optional 字段：email, nickname, avatarUrl, bio, hasPassword, passwordUpdatedAt, phoneVerifiedAt |
| [packages/shared/src/contracts/auth.ts](packages/shared/src/contracts/auth.ts) | 抽 `MeShape` 复用；修 `satisfies ZodType<Me>` 死锁 |
| [packages/shared/src/repository/types.ts](packages/shared/src/repository/types.ts) | `UserRecord` 同步加字段 |
| [apps/api/src/store/persistence.ts](apps/api/src/store/persistence.ts) | `PersistedUser` 加 profile + security 占位字段 |

### Phase 2 · 个人档案（dd50fb1）
| 文件 | 变更 |
|---|---|
| [packages/shared/src/contracts/me.ts](packages/shared/src/contracts/me.ts) | `MeProfilePatchSchema`（4 字段，optional+null=clear） |
| [apps/api/src/services/users.ts](apps/api/src/services/users.ts) | `patchUserProfile(id, patch)` —— 故意不写 userProfiles |
| [apps/api/src/routes/me.ts](apps/api/src/routes/me.ts) | `toMe()` helper + `PATCH /api/me/profile`；重写 `/api/me` 和 `/api/me/name` 用 toMe |
| [apps/api/src/routes/auth.ts](apps/api/src/routes/auth.ts) | `/verify` `/me` 改用 `toMe()` 保形状一致 |
| [apps/web/src/api/auth.ts](apps/web/src/api/auth.ts) | `updateMyProfile(patch)` |
| [apps/web/src/components/drawer/panels/YouPanel.tsx](apps/web/src/components/drawer/panels/YouPanel.tsx) | 账户头 + 4 字段编辑 section |
| [apps/api/src/__tests__/me.test.ts](apps/api/src/__tests__/me.test.ts) | +6 用例 |

### Phase 3 · 密码登录（76d2942）
| 文件 | 变更 |
|---|---|
| [apps/api/src/services/password.ts](apps/api/src/services/password.ts) | **新文件** —— scrypt 哈希 + 验证 + 强度 |
| [apps/api/src/services/users.ts](apps/api/src/services/users.ts) | `setPassword` / `loginWithPassword` / `resetPasswordViaOtp` / `revokeAllSessions` / `parseTokenVersion` / `PasswordError` |
| [apps/api/src/middleware/auth.ts](apps/api/src/middleware/auth.ts) | `requireAuth` 加 tokenVersion + deletedAt 检查；`softAuth` 失效降级匿名 |
| [apps/api/src/routes/auth.ts](apps/api/src/routes/auth.ts) | `/api/auth/password/login` + `/reset`；`/api/auth/me` 改走 requireAuth 子路由（堵 security leak） |
| [apps/api/src/routes/me.ts](apps/api/src/routes/me.ts) | `POST /api/me/password`（requireAuth 子路由） |
| [packages/shared/src/contracts/auth.ts](packages/shared/src/contracts/auth.ts) | `AuthPasswordLoginSchema` / `AuthPasswordResetSchema` / `MePasswordSetSchema` / `PasswordSchema` |
| [apps/web/src/api/auth.ts](apps/web/src/api/auth.ts) | `loginWithPassword` / `resetPassword` / `setMyPassword` |
| [apps/web/src/components/drawer/panels/YouPanel.tsx](apps/web/src/components/drawer/panels/YouPanel.tsx) | 密码 set/change section |
| [apps/api/src/__tests__/password.test.ts](apps/api/src/__tests__/password.test.ts) | **新文件** —— +17 用例 |

### Phase 4 · 手机号 / 注销 / 登出全部（6df1d02）
| 文件 | 变更 |
|---|---|
| [apps/api/src/services/users.ts](apps/api/src/services/users.ts) | `changePhone` / `deleteAccount` / `AccountError`；`ANON_PHONE_GUARD` 常量 |
| [apps/api/src/routes/me.ts](apps/api/src/routes/me.ts) | `POST /api/me/phone/change` / `/sessions/revoke-all` / `/delete`（requireAuth 子路由） |
| [packages/shared/src/contracts/me.ts](packages/shared/src/contracts/me.ts) | `MePhoneChangeSchema` / `MeAccountDeleteSchema`（refine 二选一） |
| [apps/web/src/api/auth.ts](apps/web/src/api/auth.ts) | `changeMyPhone` / `revokeAllMySessions` / `deleteMyAccount` |
| [apps/web/src/components/drawer/panels/YouPanel.tsx](apps/web/src/components/drawer/panels/YouPanel.tsx) | 三段 section + 双击确认 |
| [apps/api/src/__tests__/account-mgmt.test.ts](apps/api/src/__tests__/account-mgmt.test.ts) | **新文件** —— +19 用例 |

### Phase 5 · 前端整合（389e69e）
| 文件 | 变更 |
|---|---|
| [apps/web/src/scenes/LoginScene.tsx](apps/web/src/scenes/LoginScene.tsx) | **新文件** —— 三模式登录页 |
| [apps/web/src/stores/sessionStore.ts](apps/web/src/stores/sessionStore.ts) | `'login'` scene + `goLogin()` |
| [apps/web/src/App.tsx](apps/web/src/App.tsx) | 挂载 LoginScene |
| [apps/web/src/scenes/OpeningScene.tsx](apps/web/src/scenes/OpeningScene.tsx) | 「我已经有账号」CTA |
| [apps/web/src/components/drawer/panels/YouPanel.tsx](apps/web/src/components/drawer/panels/YouPanel.tsx) | 访客卡片「现在登录」CTA |

### Phase 6 · server 桩（本提交未单独 commit）
| 文件 | 变更 |
|---|---|
| [apps/server/src/routes/auth.ts](apps/server/src/routes/auth.ts) | 重写：5 路由桩（otp/verify/me/password/login/reset），schema 校验对齐 |
| [apps/server/src/routes/me.ts](apps/server/src/routes/me.ts) | **新文件** —— 7 路由桩 |
| [apps/server/src/index.ts](apps/server/src/index.ts) | 挂 `/api/me` |

---

## 4. 复现步骤（从干净 main 开始）

### 4.1 起点 & 整地
```bash
git checkout main
git pull
# 如有未提交工作：git stash push -u -m "<your note>"
git checkout -b feat/user-account
```

### 4.2 依次 cherry-pick 或按 Phase 拆 PR
```bash
# 单分支顺序合并：
git log --oneline 96eae5e..feat/user-account
# 应该看到 5 个 commit，按 Phase 1→5 顺序

# 或者拆 5 个独立 PR（推荐）：
git cherry-pick 507c0a2  # Phase 1
git cherry-pick dd50fb1  # Phase 2
git cherry-pick 76d2942  # Phase 3
git cherry-pick 6df1d02  # Phase 4
git cherry-pick 389e69e  # Phase 5
```

### 4.3 验证步骤
```bash
# 后端单测（必绿）
cd apps/api && pnpm test
# 期望: 195 passed (含 42 新增)

# 类型检查（必无错）
cd apps/api && pnpm typecheck
cd apps/web && pnpm typecheck
cd apps/server && pnpm typecheck
cd packages/shared && pnpm typecheck

# server 单测
cd apps/server && pnpm test
# 期望: 24 passed
```

### 4.4 端到端手验（dev server）
```bash
# 终端 1
pnpm dev:mock        # apps/api
# 终端 2
pnpm dev:web         # apps/web → localhost:5173
```

| 场景 | 预期 |
|---|---|
| 首次访问 → IntroScene → OpeningScene | 看到「我已经有账号」次级按钮 |
| 点「我已经有账号」 | 跳 LoginScene，「回到夜阑」标题 |
| 切换 "用验证码登录" | OTP 输入 + 发送验证码按钮 |
| 切换 "忘记密码" | OTP + 新密码字段 |
| 输入 `13800000001` + 任意 4-8 位 code，OTP 登录成功 | 落到对话流 |
| 打开抽屉 → 你 | 看到账户信息、4 字段编辑、密码 / 改手机 / 登出全部 / 注销账户 sections |
| 设密码 `Yelan2026` → 修改密码 | 提示「其他设备将需要重新登录」；当前设备 token 已是新的 |
| 错 5 次密码 → 第 6 次正确 | 423 ACCOUNT_LOCKED |

### 4.5 API 契约 curl 速查
```bash
BASE=http://localhost:3001

# 注册/OTP 登录
curl -X POST $BASE/api/auth/verify -H 'Content-Type: application/json' \
  -d '{"phone":"13800000001","code":"1234"}'
# → { token: "tok_v0_...", me: { id, phone, hasPassword: false, ... } }

# 设密码（需登录）
TOKEN="<above token>"
curl -X POST $BASE/api/me/password -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"newPassword":"Yelan2026"}'
# → { token: "tok_v1_...", me: { hasPassword: true, passwordUpdatedAt } }

# 密码登录（用上面新 token；旧 tok_v0 的 token 在 /api/auth/me 上会报 AUTH_EXPIRED）
curl -X POST $BASE/api/auth/password/login -H 'Content-Type: application/json' \
  -d '{"phone":"13800000001","password":"Yelan2026"}'
# → { token: "tok_v1_...", me: { ... } }

# 改档案
curl -X PATCH $BASE/api/me/profile -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"email":"a@example.com","nickname":"夜阑"}'

# 改手机号
curl -X POST $BASE/api/me/phone/change -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"newPhone":"13900000099","code":"1234"}'

# 登出全部设备
curl -X POST $BASE/api/me/sessions/revoke-all -H "Authorization: Bearer $TOKEN"

# 注销账户
curl -X POST $BASE/api/me/delete -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"currentPassword":"Yelan2026"}'
```

---

## 5. 风险登记 & Backlog

### 已实施的缓解
| 风险 | 缓解 |
|---|---|
| Me schema satisfies 死锁 | 抽 MeShape，类型与 zod 一处写 |
| patchUserName 污染 userProfiles | 调研发现是故意行为（LLM context）；不修，但 Phase 2 测试断言隔离 |
| anon 用户被改/删 | `ANON_PHONE_GUARD` 在 services 层硬编码守卫 + 多个测试覆盖 |
| 密码改后旧 token 仍可用 | tokenVersion 嵌入 token + middleware 校验 |
| `/api/auth/me` 绕过 tokenVersion | 改走 requireAuth 子路由（Phase 3 顺手修） |
| 开门流被强校验破坏 | softAuth 对过期 token 降级而非 401 |
| 频繁试密码爆破 | 5 次失败锁 15 分钟 |
| passwordHash 泄露 | toMe 永不返回；hasPassword 派生 |
| phoneIndex 冲突 | 改号原子 swap + 409 PHONE_TAKEN |
| ANON_PHONE 守卫不一致 | services 与 middleware 都各自定义；建议下次合并到 shared 常量 |

### Backlog（未做，需后续工作）
- [ ] `apps/server` 真正实现所有路由（目前 501，依赖 mock-fallback proxy）
- [ ] tokenIndex 累积清理（cron 或 LRU）
- [ ] `deletedAt` 30 天后物理删除作业
- [ ] 匿名号合并真账户（烛账、对话历史合并）
- [ ] 头像上传（签名 URL + 对象存储）
- [ ] 邮箱验证（发送验证邮件、绑定）
- [ ] 二要素认证（TOTP）
- [ ] 数据导出（GDPR-style）
- [ ] LoginScene 后续：成功后直接跳 select 而不是 restart 到 intro
- [ ] 登录失败时显示「剩余 X 次」提示
- [ ] `ANON_PHONE` 常量统一到 shared
- [ ] `/api/me/sessions/list`（显示活跃设备清单）
- [ ] `/api/me/audit`（用户自查最近登录历史）

### 已知 trade-offs（已接受）
- 失败计数无 sliding window，第 5 次失败立刻锁 15 分钟，不渐进式锁
- 密码 reset 用 OTP 在 mock 环境任意 4-8 位通过，**生产必须真验证**（在 apps/server 桩里补上）
- LoginScene 成功后调用 `restart()` 回到 intro 而非直接跳 select —— 简化但 UX 不完美
- panel.module.css 当前无 statCard/rowTitle/rowMeta 类（在 stash 里），YouPanel 用基础类拼

---

## 6. 主分支冲突预警

| 文件 | 当前分支 vs main | 与 stash@{0} 冲突 |
|---|---|---|
| `apps/api/src/routes/chat.ts` | 未碰 | stash 有改动（memory gate） — 合并 stash 时无冲突 |
| `apps/api/src/middleware/auth.ts` | **改了**（tokenVersion） | stash 未碰 — 安全 |
| `apps/api/src/services/users.ts` | **大改**（+278 行） | stash 未碰 — 安全 |
| `apps/api/src/store/persistence.ts` | +16 行（user 字段） | stash 未碰 — 安全 |
| `apps/api/src/routes/me.ts` | **大改** | stash 未碰 — 安全 |
| `apps/web/src/components/drawer/panels/YouPanel.tsx` | **大改**（+330 行） | **stash 也大改**（panel 样式） — **会冲突**，需 3-way merge |
| `apps/web/src/components/drawer/panels/panel.module.css` | 未碰 | stash 加 267 行新样式 — 解 stash 时可直接 apply |
| 其他 panel.tsx（Breath/Memory/Survey 等） | 未碰 | stash 都改了 — 解 stash 时可直接 apply |

**建议合并顺序**：
1. 先 PR 合 `feat/user-account` 到 main
2. 再 `git stash pop`，预期只在 YouPanel.tsx 有冲突 → 3-way merge（保留两边的 section，把 stash 的样式类应用到本分支新增的 section）
3. 把 stash 拆成 panel-polish PR、memory-probe-scripts PR

---

## 6.5 stash 残留处理（Post-1 / Post-2 后追加）

**Post-1 已完成**（commit `1974712 chore(web): apply drawer panel polish from prior stash`）：从 stash 取出 11 个 panel polish 文件，提交到当前分支。YouPanel.tsx 保留 user-account 版本不取（更丰富、且基础类不依赖新样式）。

**stash@{0} 仍未删**，仍保留全部原始内容（13 文件 + 2 untracked scripts，979 行）。这是有意的：

1. **memory-gate 残留**（`apps/api/src/routes/chat.ts` 8 行 + `apps/api/scripts/probe-{10rounds,memory-gate}.ts`）属于 `feat/memory-gate-integration` 分支，必须在该分支上恢复。
2. **panel polish 已提交**（在 Post-1 commit），但 stash 里仍有完整副本 → 如果你直接 `git stash pop`，会和 Post-1 的 11 个文件全部冲突。

### 推荐恢复流程

```bash
# 1) memory-gate 收尾：切到原分支恢复那 3 个文件
git switch feat/memory-gate-integration
git checkout "stash@{0}" -- \
  apps/api/src/routes/chat.ts \
  apps/api/scripts/probe-10rounds.ts \
  apps/api/scripts/probe-memory-gate.ts
git status   # 看 chat.ts 是否真有改动（如果 memory-gate 分支已演进可能 no-op）
# 如果 chat.ts 现在没冲突且需要这段改动 → 单独 commit
git add apps/api/src/routes/chat.ts apps/api/scripts/
git -c commit.gpgsign=false commit -m "wip(memory-gate): debug system prompt logging + skipMemory undefined"

# 2) 切回任意分支后，安全 drop stash
git switch -          # 回到之前的分支
git stash drop stash@{0}
```

### 如果懒得管 memory-gate 那条线

```bash
# 只想要 panel polish（已经在 feat/user-account 拿到了）+ 想丢 stash：
git stash drop stash@{0}      # 直接丢，chat.ts 那 8 行改动会丢失
```

`chat.ts` 残留改动的内容（参考，便于决定是否值得保留）：
- `skipMemory ? { preferences: [], events: [] } : body.recall` → `skipMemory ? undefined : body.recall`（注释：节流时让 assemble 完全省略 `[她记得]` 标签）
- 加 `DEBUG_SYSTEM_PROMPT=on` 环境变量开关，开启时 console.log 完整 system prompt（调试用）

如果这两条改动 memory-gate 分支已经有别的方式实现 → 可直接 drop stash 不管。

---

## 6.6 codex 审计 P1 修复（追加）

外部审计 codex 发现两个 P1，已修：

### P1 #1 · 已注销账号能被 OTP「复活」
- **根因**：[services/users.ts:47](apps/api/src/services/users.ts:47) `getOrCreateUserByPhone` 命中 phoneIndex 直接返回 user，不看 `deletedAt`；[routes/auth.ts:51](apps/api/src/routes/auth.ts:51) `/api/auth/verify` 用它发 token。
- **后果**：调过 `/api/me/delete` 后，再发一次 OTP → 200，token 又出来了，"注销即失效"形同虚设。
- **修复**：
  - `getOrCreateUserByPhone` 命中 deleted user 抛 `UserDeletedError`
  - `/api/auth/verify` 捕获 → 返回 410 ACCOUNT_DELETED
  - `apps/server/src/routes/auth.ts` 桩里加 CRITICAL 注释提醒真实现也要做同样检查
- **回归测试**：[p1-regressions.test.ts](apps/api/src/__tests__/p1-regressions.test.ts) `P1 #1` 套件（4 个用例）

### P1 #2 · stale token PATCH /profile 写入匿名共享号
- **根因**：[routes/me.ts:32](apps/api/src/routes/me.ts:32) 全局 `softAuth()` 覆盖所有路径；[routes/me.ts:73](apps/api/src/routes/me.ts:73) `PATCH /profile` 没像 password / phone / delete 那样进 requireAuth 子路由。
- **后果**：过期 token PATCH /profile → softAuth 降级到 ANON_PHONE 匿名号 → 200，nickname/email 被写到 `00000000000` 共享账户。其他用户的访客状态被污染，**调用方完全感知不到失败**。
- **修复**：
  - 把 PATCH /profile 移到 `accountSubRoute`（已有 `requireAuth()` 拦截）
  - PATCH /name **保留 softAuth** —— 那是 NameScene 开门流契约，未登录访客需要能写 name 到匿名号；已加注释说明 trade-off
  - `apps/server/src/routes/me.ts` 桩里加 CRITICAL 注释
- **回归测试**：`P1 #2` 套件（4 用例）+ `PATCH /name 契约` 套件（1 用例）

### 口径修复
- `packages/shared/package.json` 加 `"typecheck": "tsc --noEmit"`（codex 指出原本缺）
- diff 行数：codex 看到的 34 files / +3360 / −131 是包含 Post-1 panel polish + 审计文档的全量；之前摘要的 19 / +1982 / −74 是 user-account 主体 6 个 Phase commit 的口径。两个都对，对比 base 不同。

### 经验沉淀（updated risk register）
| 风险 | 缓解 |
|---|---|
| **softAuth 写操作降级污染匿名** | 写操作（POST/PATCH/DELETE）一律放进 requireAuth 子路由；唯一例外 PATCH /name（开门流契约，已注释） |
| **deletedAt 在 service 层漏检** | `getOrCreateUserByPhone` 主动抛 `UserDeletedError`；`loginWithPassword` / `resetPasswordViaOtp` / `changePhone` / `deleteAccount` 已各自检查；middleware 通过 `shouldRejectToken` 兜底 |
| **shared 包 typecheck 漏跑** | 加 typecheck script，本地与 CI 都跑得到 |

---

## 6.7 email-auth phase（2026-05-21 追加）

UI 视角的"两个昵称"问题暴露后顺水推舟把登录路径切到邮箱+密码，phone OTP 保留为 legacy。`user.id` 84 处 FK 不动（surrogate），同时保留三者（id / email / name），phone 降级为 optional。

### 改动清单
| 文件 | 改动 |
|---|---|
| [packages/shared/src/contracts/auth.ts](packages/shared/src/contracts/auth.ts) | `EmailSchema`（trim+lowercase）/ `AuthEmailRegisterSchema` / `AuthEmailLoginSchema`；`MeShape.phone` 改 optional |
| [packages/shared/src/contracts/me.ts](packages/shared/src/contracts/me.ts) | `MeEmailBindSchema`；`MeProfilePatchSchema.email` 改用 EmailSchema |
| [packages/shared/src/types/user.ts](packages/shared/src/types/user.ts) | `Me.phone` 改 optional |
| [apps/api/src/store/persistence.ts](apps/api/src/store/persistence.ts) | `PersistedUser.phone` 改 optional；新增 `emailIndex: Record<string,string>`；`normalizeLoadedState` 兜底 + 老数据回填 emailIndex；**修了 test-clobber 第二次事故 → STATE_DIR 检测 VITEST/NODE_ENV 重定向到 `.local-test/`** |
| [apps/api/src/services/users.ts](apps/api/src/services/users.ts) | `EmailAuthError`、`normalizeEmail`、`registerWithEmail` / `loginWithEmail` / `bindEmail`；`patchUserProfile` 维护 emailIndex 与唯一性；`changePhone` 容忍 u.phone undefined |
| [apps/api/src/routes/auth.ts](apps/api/src/routes/auth.ts) | `POST /api/auth/email/register` / `POST /api/auth/email/login` |
| [apps/api/src/routes/me.ts](apps/api/src/routes/me.ts) | `POST /api/me/email/bind`；`PATCH /profile` 捕获 EmailAuthError → 409；`toMe` phone 缺省省略 |
| [apps/server/src/routes/auth.ts](apps/server/src/routes/auth.ts) | 两条 email 路由桩 + CRITICAL 注释（normalize / deletedAt / lockout） |
| [apps/server/src/routes/me.ts](apps/server/src/routes/me.ts) | `POST /api/me/email/bind` 桩 |
| [apps/api/src/\_\_tests\_\_/email-auth.test.ts](apps/api/src/__tests__/email-auth.test.ts) | **新文件** —— 15 用例（register / login / bind / patch email + emailIndex；含首次 bind 弱密码不占用 email 的回归） |
| [apps/web/src/api/auth.ts](apps/web/src/api/auth.ts) | `registerWithEmail` / `loginWithEmail` / `bindMyEmail` |
| [apps/web/src/scenes/LoginScene.tsx](apps/web/src/scenes/LoginScene.tsx) | 重构：`email-login` / `email-register` 主入口，phone 三模式收到「其他登录方式」折叠区 |
| [apps/web/src/components/drawer/panels/YouPanel.tsx](apps/web/src/components/drawer/panels/YouPanel.tsx) | account header 优先展示 email，显示 ID；新增独立「邮箱（用于登录）」section 智能切换 bind/patch；移除「昵称」section（与「称呼」语义重叠） |
| [apps/admin/src/routes/Users.tsx](apps/admin/src/routes/Users.tsx) | 列表加「邮箱」列；编辑 modal 展示 email/phone 两栏；phone 可空 |
| [apps/web/src/scenes/Conversation.tsx](apps/web/src/scenes/Conversation.tsx) | **修了沈砚之"点进去空白"** —— 空 messages 快照视同无快照走 reset；空 messages 时不落盘 |
| `.gitignore` | 加 `.local-test/` |

### 关键设计决策
| 抉择 | 选择 | 理由 |
|---|---|---|
| user.id 是否改成 email | **不改** | 84 个 FK 引用 + 200 个测试，重写代价 vs 收益不成比例；email 单独做 login 标识即可 |
| phone 是否完全废弃 | **不废，降级 optional** | 现有 2 个 phone 用户零迁移；email-bind 路径让他们自己升级 |
| 邮箱验证（激活链接） | **不做** | 本轮零外部依赖；防滥用靠 PasswordSchema 强度 + 5 次 lockout |
| 大小写敏感性 | **不敏感**（normalize trim+lowercase） | `Foo@x.com` 与 `foo@x.com` 同一账户，避免重复注册 |
| 匿名访客流是否保留 | **保留** | 开门流（OpeningScene→NameScene→CharacterSelect）继续 anon 匿名号；登录是 opt-in，不堵首屏 |
| 首次 bind 强制密码 | **强制**（无密码用户必须同时传 password） | 否则绑了邮箱也没办法 email login，等于半成品状态 |
| `PATCH /profile` 改 email 是否也维护 emailIndex | **维护**（携带唯一性 + atomic swap） | 让 /profile patch 和 /email/bind 行为一致；保险 |

### 错码表（新增）
| HTTP | code | 触发 |
|---|---|---|
| 409 | `EMAIL_TAKEN` | 注册 / bind / patch /profile 改 email 时已被占用（含被注销用户） |
| 400 | `NO_PASSWORD` | bind 无密码用户但没同时传 password |
| 400 | `PASSWORD_WEAK` | bind 无密码用户同时传 password，但密码不满足强度规则 |
| 401 | `PASSWORD_WRONG` | email login 密码错 |
| 423 | `ACCOUNT_LOCKED` | email login 失败 5 次锁 15 分钟 |
| 404 | `NOT_FOUND` | email login 找不到（含 deletedAt） |

### 测试增量
- `apps/api`: 204 → 219（+15 email-auth）
- `apps/server`: 24 → 24（桩未加测试）
- typecheck: shared / api / server / web / admin 5 包全过

### 新风险登记
| 风险 | 缓解 |
|---|---|
| email 与 phone 双登录入口 → 同一账户多登录路径，弃用 phone 后老用户找不到入口 | LoginScene 折叠区永远保留 phone，YouPanel email section 文案明确「用于登录」；后续 backlog 加用户引导提示 |
| profile.email 与 bind email 双写入口 → emailIndex 一致性 | 后端 `patchUserProfile` 和 `bindEmail` 共用 emailIndex 唯一性 + atomic swap；测试覆盖了两条路径 |
| **test-clobber 第二次事故** | persistence.ts STATE_DIR 自动检测 VITEST/NODE_ENV/YELAN_STATE_DIR 三重重定向；test 路径走 `.local-test/`，已加 .gitignore |

### Backlog（email-auth 引入的）
- [ ] OpeningScene "我已经有账号" 跳 LoginScene 后默认聚焦 email 输入框
- [ ] 邮箱验证（激活链接 / 防伪 email）— 接 SMTP/Postmark/SES
- [ ] phone-only 老用户的引导提示：「绑定邮箱以更稳的登录」
- [ ] email-bind 错码翻译完整化（前端 EMAIL_TAKEN 已覆盖，NO_PASSWORD 也覆盖了）
- [ ] `/api/auth/email/forgot`（密码重置）— 目前邮箱用户忘记密码只能管理员重置

---

## 7. 一句话总结

**+1982 / −74 行，5 个 phase commit，42 个新测试，零新依赖。** 用户系统从「OTP 任意通过 + 仅能改名」演进为「OTP 与密码并行登录 + 完整档案编辑 + 改号注销登出全部 + 防爆破锁定 + token 版本号失效」。开门流与 softAuth 匿名兼容性零破坏。生产 `apps/server` 同名桩对齐，前端到生产路径有清晰的 NOT_IMPLEMENTED 错误而非 404 路径错位。
