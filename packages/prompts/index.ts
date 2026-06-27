// Prompt 资产入口。本包内的 yaml/md 是真理源；构建期由 scripts/build.ts 烘成 src/generated.ts。
// 服务端运行时优先查 KV 取灰度版本，KV miss 时回退到这里的默认值（见 apps/server/src/prompts/loader.ts）。
export {
  characters,
  strategies,
  boundaries,
  systemTemplate,
  ASSET_VERSION,
} from './src/generated';
export type { CharacterCard } from './src/generated';
