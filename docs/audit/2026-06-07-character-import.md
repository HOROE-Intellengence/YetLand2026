# 角色包粘贴导入审计

日期：2026-06-07

## 范围

本次实现后台角色卡“推荐版”粘贴导入：

- `packages/shared` 定义导入包 schema、归一化函数、preview/commit 响应合同。
- `apps/api` 增加 `/api/admin/characters/import/preview` 与 `/api/admin/characters/import`。
- `apps/admin` 在角色卡面板增加“导入角色包”弹窗。

## 输入格式

支持 SOP S4 产物：

```json
{
  "card": { "name": "...", "slug": "...", "styleTags": [], "profileSections": [] },
  "operatorFields": { "rarity": "free", "priceCandle": 0 },
  "tier2": { "userRole": {}, "relationship": "...", "memo": [] }
}
```

导入只写主 `card`。`tier2` 会被识别并在预览中警告，但当前不入库，避免把用户角色、关系和 memo 污染进主角色 system prompt。

## 风险与处理

| 风险 | 处理 |
|---|---|
| 前端自行解析导致后端写入不一致 | 前后端都使用 shared schema；提交时后端重新解析 raw。 |
| JSON 非法 | preview 返回 `INVALID_JSON`，不落库。 |
| 字段超长或 slug 不合法 | shared 归一化后走 `AdminCharacterImportPayloadSchema`，失败返回错误，不静默截断。 |
| profileSections 顺序混乱 | 导入时按 order 排序并重排为 0..n。 |
| 空设定项 | 预览警告并丢弃空 section。 |
| 重复导入覆盖错误角色 | preview 根据 slug 查现有角色；`create/update/upsert` 三模式显式约束。 |
| 写入不可追溯 | commit 落 `character.import` 审计，记录 mode/action/slug/tier2Detected/warnings。 |

## 验证

已跑：

- `pnpm --filter @yelan/shared test src/contracts/admin.test.ts`
- `pnpm --filter @yelan/api test src/__tests__/character-import.test.ts`
- `pnpm --filter @yelan/admin typecheck`

覆盖点：

- shared：归一化、去重、order 重排、tier2 警告、超长字段拒绝。
- API：preview 不写库、import 写库并落审计、create-only 冲突拦截。
- Admin：新导入弹窗通过 TypeScript 检查。

## 后续

档②需要单独存储，例如 `tier2Presets` / `characterRolePresets`。不要复用 `profileSections`，那会破坏主角色 prompt 边界。
