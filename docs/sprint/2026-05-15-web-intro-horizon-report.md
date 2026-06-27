# WEB-201 + WEB-202 验证报告

| 声称 | 验证命令 | 结果 |
|---|---|---|
| WEB-201 已作为独立 commit 落地 | `git log --oneline -2` | `1e3fca4 feat(web): port IntroScene cinematic ignition from 快速启动.html (WEB-201)` |
| WEB-202 已作为独立 commit 落地 | `git log --oneline -2` | `e4eab81 feat(web): replace boxed containers with sunrise-horizon underline (WEB-202)` |
| 真前端 build 通过 | `pnpm --filter @yelan/web build` | 退出码 0; `tsc -b && vite build` 成功 |
| 灰度总门禁通过 | `pnpm verify:gray` | 退出码 0; `Errors: 0`; 输出包含 `CI PASSED` |
| 三个目标场景已移除 `border: 1px solid` | `Select-String -Path apps/web/src/scenes/OpeningScene.module.css,apps/web/src/scenes/CharacterSelect.module.css,apps/web/src/scenes/Conversation.module.css -Pattern 'border: 1px solid'` | 0 命中 |
| IntroScene 已有真实 phase 时序 | `Select-String -Path apps/web/src/scenes/IntroScene.tsx -Pattern 'setPhase'` | 8 命中 |
| IntroScene 已移除占位文本 | `Select-String -Path apps/web/src/scenes/IntroScene.tsx -Pattern '占位'` | 0 命中 |
| 地平线共享样式文件存在 | `Test-Path apps/web/src/styles/horizon.module.css` | `True` |
| IntroScene 需要的 9 个全局 keyframes 已追加 | `Select-String -Path apps/web/src/styles/globals.css -Pattern '@keyframes (emberBeat|flameFlicker|ripple|sigilSpinCW|sigilSpinCCW|starTwinkle|titleBreathe|petalBurst|sealPulse)'` | 9 命中 |

视觉验收不在本报告范围内; 按 spec 由 PM 跑 `pnpm dev:web` 人工查看启动动画与地平线光效。
