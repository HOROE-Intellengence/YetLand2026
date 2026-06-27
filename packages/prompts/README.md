# @yelan/prompts — Prompt as Code

> 修订 #22：Prompt 不是护城河，但工程化 + 灰度 + 重放是基本能力。

## 文件组织

```
packages/prompts/
├── characters/         # 角色卡 yaml — 一个角色一个文件（PM/Prompt 工程师改这里）
├── strategies/         # 阶段策略 md（同上）
├── boundaries/         # 内容边界条款 md（同上）
├── system.template.md  # 主模板
├── scripts/build.ts    # 构建期把上面所有文件烘成 src/generated.ts
├── src/generated.ts    # 自动生成 — 不要手改
└── index.ts            # 对外导出
```

## 构建（开发期 + CI 必跑）

```bash
pnpm --filter @yelan/prompts build         # 一次生成
pnpm --filter @yelan/prompts watch         # 开发期监听 yaml/md 变更
```

服务端代码这样消费：

```ts
import { characters, strategies, boundaries, systemTemplate } from '@yelan/prompts';
const card = characters['shen-yan-zhi'];
```

之所以构建期烘 —— Cloudflare Workers 运行时没有文件系统，必须把 yaml/md 内联进 JS 包。改 yaml/md 后**必须重新 build**才能生效（开发期跑 `watch` 自动）。

## 灰度发布

服务端启动时先查 KV：`character:<id>` / `strategy:<stage>` / `boundary:<level>`。命中 KV 取灰度版本，否则回退到本目录的默认。

灰度通过 `/api/admin/prompts/release` 写入 KV，按用户 hash 分流。

## 修改流程

1. 改 yaml/md
2. PR review（PM + Prompt 工程师双签）
3. CI 校验：必须能完整组装 system prompt（不抛错）+ 跑 50 个测试输入跨 5 个 boundary
4. merge → 灰度 10% → 一周 hit rate / 评分对比 → 全量 / 回滚
