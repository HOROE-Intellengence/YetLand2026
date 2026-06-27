# Spec: 真前端启动动画移植 + 日出地平线去框 UI

- **类型**:Spec(实施细则 — 改哪个文件 / 代码骨架 / 验收命令)
- **执行层**:Codex(用户已拍板由 Codex 直接改文件,覆盖协议 §7)
- **范围**:`apps/web`(真前端)。抽屉面板 / tweaks 面板**本工单不动**,后续工单。
- **工单**:`WEB-201`(启动动画移植)+ `WEB-202`(日出地平线去框)。一份 spec,**两个 commit**(一 commit 一工单)。
- **参考**:仓库根 `快速启动.html` —— 里面有一份完整跑通的 `IntroScene`,是移植源。

---

## 背景

1. `apps/web/src/scenes/IntroScene.tsx` 现在是**空占位 stub**(`{/* 占位 */}`),启动动画从没移植过。
2. 当前 UI 的文本容器都用 `border: 1px solid` 完整方框框住。要改成**无框**:文本只被底部一条**会发光的"日出地平线"**托住,只保留下框线。
3. 下框线不能是敷衍的硬直线 —— 要两端虚化(地平线感)+ 中央升起一团暖光(日出感)。

---

## 工单 WEB-201:启动动画移植

把 `快速启动.html` 里的 `IntroScene` 移植进真前端。

### 改的文件

| 文件 | 动作 |
|---|---|
| `apps/web/src/scenes/IntroScene.tsx` | **整体重写**(移植参考实现) |
| `apps/web/src/scenes/IntroScene.module.css` | 重写(`.root` + `.sigilWrap`) |
| `apps/web/src/styles/globals.css` | **追加** 9 个 keyframes |

### 移植源

`快速启动.html` 的 `IntroScene` 函数(**307–549 行**)。先 `Read` 这段。

### 适配规则(逐条照做,不要自由发挥)

1. **签名**:`function IntroScene({ onDone })` → `export function IntroScene()`。
   组件不接受 props。在组件内取 store:
   ```ts
   import { useSessionStore } from '../stores/sessionStore';
   const goOpening = useSessionStore((s) => s.goOpening);
   ```
   参考代码里所有 `onDone` 调用 → 改成 `goOpening`(共 2 处:`setTimeout(onDone, 10400)` 和 `skip` 里的 `setTimeout(onDone, 500)`)。

2. **Hooks**:参考文件顶部别名 `useS/useE/useR/useM` = `useState/useEffect/useRef/useMemo`。
   移植后用真名,从 `'react'` import。`useCb` 在 IntroScene 里没用到,不用 import。

3. **TSX 类型**:
   - canvas ref:`useRef<HTMLCanvasElement>(null)`(`inkRef` / `sparksRef`)。
   - `useState(0)` 给 `phase`,类型自动推断 number,不用显式标注。
   - 内联 `style` 对象在 TSX 里直接用,React 已有类型;`mixBlendMode` / `transformOrigin` 等驼峰属性原样保留。

4. **className 映射**(参考用全局类,真前端用 CSS Module):
   - `className="scene-intro"` → `className={styles.root}`
   - `className="sigil-wrap"` → `className={styles.sigilWrap}`
   - IntroScene 内部没用到 `.particles`,忽略。

5. **修复参考里的 latent bug**:参考 456 行 `<circle ... fill="url(#halo1)" />` 引用了一个**未定义**的 `halo1` 渐变。移植时在该 SVG 的 `<defs>` 里**补上**:
   ```jsx
   <radialGradient id="halo1" cx="50%" cy="50%" r="50%">
     <stop offset="0%" stopColor="rgba(232,168,84,0.16)" />
     <stop offset="60%" stopColor="rgba(132,70,110,0.06)" />
     <stop offset="100%" stopColor="rgba(0,0,0,0)" />
   </radialGradient>
   ```

6. **keyframes**:参考的内联 `style` 里的 `animation` 引用了 keyframes。内联样式不经 CSS Modules 处理,所以 keyframes **必须是全局的** —— 追加到 `apps/web/src/styles/globals.css`(那里已有 `breathe` / `fadeUp` 全局 keyframes 的先例)。
   从 `快速启动.html` **45–79 行**原样复制这 9 个:`emberBeat` `flameFlicker` `ripple` `sigilSpinCW` `sigilSpinCCW` `starTwinkle` `titleBreathe` `petalBurst` `sealPulse`。
   `breathe` / `fadeUp` 已在 globals.css,**不要重复定义**。`typingDot` / `achFlash` / `inkBloom` IntroScene 没用到,**不要复制**。

7. **IntroScene.module.css** 目标内容:
   ```css
   .root {
     position: absolute;
     inset: 0;
     z-index: 20;
     background: #000;
     cursor: pointer;
     overflow: hidden;
   }

   .sigilWrap {
     position: absolute;
     left: 50%;
     top: 50%;
     transform: translate(-50%, -50%);
     transition: opacity 2.2s cubic-bezier(.2, .6, .2, 1),
                 transform 2.4s cubic-bezier(.2, .6, .2, 1),
                 filter 1.6s ease;
   }
   ```

8. 其余逻辑(phase 时序、ink/sparks canvas、星图、涟漪、法阵 SVG、花瓣、烛焰、SVG 题字、`skip`)**全部照搬**,只做上面 1–7 的机械适配。

9. 确认 `apps/web/src/App.tsx` 仍渲染 `<IntroScene />`(无 props)。它本来就这么渲染,通常无需改;若 App 给 IntroScene 传了 props,删掉那些 props。

---

## 工单 WEB-202:日出地平线去框 UI

文本容器去掉方框,只留底部一条发光地平线。

### 新建共享样式

新建 `apps/web/src/styles/horizon.module.css`,内容**逐字如下**:

```css
/* 日出地平线 — 文本容器的发光下框线。
 * 文本容器不再用 border 方框,只保留一条底部地平线 + 从中央升起的暖光。
 * 用法:场景 .module.css 里 composes: horizonField from '../styles/horizon.module.css';
 * 注意:<input>/<textarea> 不渲染 ::before/::after,必须套一层 <div> 包裹后应用。 */

@keyframes horizonBreathe {
  0%, 100% { opacity: 0.38; }
  50%      { opacity: 0.6; }
}

.horizonField {
  position: relative;
  background: transparent;
  border: none;
  border-radius: 0;
}

/* 地平线 — 两端虚化的渐变线,不是硬直线 */
.horizonField::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 1px;
  background: linear-gradient(
    to right,
    transparent 0%,
    rgba(160, 128, 96, 0.45) 22%,
    var(--gold-light) 50%,
    rgba(160, 128, 96, 0.45) 78%,
    transparent 100%
  );
  transition: background 0.45s ease;
  pointer-events: none;
}

/* 日出光晕 — 从地平线中央升起的椭圆暖光,托住上方文字 */
.horizonField::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 32px;
  background: radial-gradient(
    ellipse 58% 100% at 50% 100%,
    var(--gold-glow) 0%,
    rgba(200, 168, 120, 0.14) 40%,
    transparent 74%
  );
  opacity: 0.42;
  animation: horizonBreathe 8s ease-in-out infinite;
  transition: opacity 0.45s ease, height 0.45s ease;
  pointer-events: none;
}

/* hover / focus — 日出渐强 */
.horizonField:hover::before,
.horizonField:focus-within::before,
.horizonField:focus-visible::before {
  opacity: 0.95;
  height: 42px;
  animation: none;
}

.horizonField:hover::after,
.horizonField:focus-within::after,
.horizonField:focus-visible::after {
  background: linear-gradient(
    to right,
    transparent 0%,
    rgba(200, 168, 120, 0.65) 16%,
    rgba(245, 232, 208, 1) 50%,
    rgba(200, 168, 120, 0.65) 84%,
    transparent 100%
  );
}
```

**设计意图**(给执行层背景,不许改参数):地平线渐变两端 `transparent` → 线不是硬边直线;`::before` 椭圆径向光从底部中央升起 = 日出;rest 态 `horizonBreathe` 让光微微呼吸(有生命),hover/focus 态光晕变亮变高 = 日出渐强。

### 应用到 3 个场景

CSS Modules 的 `composes` 会让元素同时挂上两个 class,`.horizonField` 的 `::before/::after` 因此生效。`composes` 必须是该 class 的**第一行声明**。

#### `apps/web/src/scenes/OpeningScene.module.css`

- `.greetBtn`:
  - 第一行加 `composes: horizonField from '../styles/horizon.module.css';`
  - 删 `background` / `border` / `border-radius`
  - `padding` 改 `12px 28px 16px`(底部多留 4px 给地平线)
  - 保留 `color` / `font-*` / `transition`
- `.greetBtn:hover`:删 `border-color` / `background`,保留 `color` / `text-shadow`
- `.enterBtn`:同样 —— 加 `composes`,删 `background` / `border` / `border-radius`,保留 `color: var(--gold-light)` / `opacity: 0.5`
- `.enterBtn:hover`:删 `background`,保留 `opacity: 1`

#### `apps/web/src/scenes/CharacterSelect.module.css`

- `.card`:加 `composes: horizonField from '../styles/horizon.module.css';`,删 `background` / `border` / `border-radius`,保留 `width: 180px` / `transition`,`padding` 改 `24px 16px 28px`
- `.card:hover`:删 `border-color` / `background`,保留 `transform: translateY(-2px)`
- `.tag`:删 `background` / `border-radius`,`padding` 改 `0`(小药丸太小不适合地平线 —— 直接退化成纯文字,`color: var(--paper-mute)` 保留)

#### `apps/web/src/scenes/Conversation.module.css` + `Conversation.tsx`

- **TSX 改动**:`<textarea>` 不渲染伪元素,必须包一层。把 `Conversation.tsx` 134–141 行的 `<textarea>` 包进 `<div>`:
  ```tsx
  <div className={styles.inputField}>
    <textarea
      ref={inputRef}
      className={styles.input}
      placeholder="输入消息..."
      rows={1}
      disabled={sending}
      onKeyDown={handleKeyDown}
    />
  </div>
  ```
- CSS:
  - `.inputBar`:删 `border-top`(地平线由输入框自己出,不要双线)
  - 新增 `.inputField`:
    ```css
    .inputField {
      composes: horizonField from '../styles/horizon.module.css';
      flex: 1;
      display: flex;
    }
    ```
  - `.input`(textarea):删 `background` / `border` / `border-radius` / `flex: 1`(`flex` 移到 wrapper),加 `width: 100%`,保留 `padding` / `font-*` / `resize: none` / `min-height` / `line-height`
  - `.input:focus`:删 `border-color`(wrapper 的 `:focus-within` 接管)
  - `.sendBtn`:加 `composes: horizonField from '../styles/horizon.module.css';`,删 `background` / `border` / `border-radius`,保留 `color: var(--gold-light)` / `padding` / `white-space`
  - `.sendBtn:hover:not(:disabled)`:删 `background`(可保留一个轻 `color` 提亮,或留空)
  - `.tempBadge`:删 `background` / `border-radius`,退化成纯文字

---

## 红线(复述在此,不许"看文档自查")

- ❌ 不动 `apps/web` 之外的任何文件。
- ❌ 不动抽屉面板(`components/drawer/**`)、tweaks 面板(`components/tweaks/**`)—— 后续工单。
- ❌ 不改 `horizon.module.css` 里的任何数值 / 渐变 stop —— 那是定稿的设计参数。
- ❌ 不"顺便"重构 / 改名 / 清理别的东西。
- ❌ 不改 `sessionStore.ts` / `App.tsx` 的逻辑(App.tsx 只允许在它给 IntroScene 传了多余 props 时删 props)。
- ❌ 移植 IntroScene 不许"简化"参考实现 —— phase 时序、canvas、SVG 全部照搬。
- ✅ 一 commit 一工单:WEB-201 一个 commit,WEB-202 一个 commit。
- ✅ commit message 规范:`<type>(<scope>): <desc> (<工单 ID>)`,例:
  `feat(web): port IntroScene cinematic ignition from 快速启动.html (WEB-201)`
  `feat(web): replace boxed containers with sunrise-horizon underline (WEB-202)`

---

## 成功 criteria(用命令表达)

WEB-201 + WEB-202 完成 = 以下全部通过:

| # | 命令 | 期望 |
|---|---|---|
| 1 | `pnpm --filter @yelan/web build` | 退出码 0,无 TS 报错 |
| 2 | `pnpm verify:gray` | 全绿 |
| 3 | `Select-String -Path apps/web/src/scenes/OpeningScene.module.css,apps/web/src/scenes/CharacterSelect.module.css,apps/web/src/scenes/Conversation.module.css -Pattern 'border: 1px solid'` | **0 命中** |
| 4 | `Select-String -Path apps/web/src/scenes/IntroScene.tsx -Pattern 'setPhase'` | 命中 > 0(占位已被真实现替换) |
| 5 | `Select-String -Path apps/web/src/scenes/IntroScene.tsx -Pattern '占位'` | **0 命中** |
| 6 | `Test-Path apps/web/src/styles/horizon.module.css` | True |
| 7 | `Select-String -Path apps/web/src/styles/globals.css -Pattern '@keyframes (emberBeat|flameFlicker|ripple|sigilSpinCW|sigilSpinCCW|starTwinkle|titleBreathe|petalBurst|sealPulse)'` | 命中 9 条 |

视觉验收(动画是否好看、地平线光是否对)由 PM 跑 `pnpm dev:web` 人工看,不在 Codex 职责内。

---

## 报告要求

完成后写 `docs/sprint/2026-05-15-web-intro-horizon-report.md`,每条声称附"验证命令"列(让别人能机械复跑)。卡住了 → 写 `docs/sprint/2026-05-15-blocker-<topic>.md`,停手,不要凭感觉发挥。

---

## 一段话版本

把 `快速启动.html` 307–549 行的 `IntroScene` 移植进真前端 `apps/web/src/scenes/IntroScene.tsx`(占位 stub → 真实现),`onDone` 换成 store 的 `goOpening`,9 个 keyframes 追加到 `globals.css`,补一个参考里漏定义的 `halo1` 渐变(WEB-201);再新建 `apps/web/src/styles/horizon.module.css` 共享样式 —— 文本容器去掉 `border` 方框,改成底部一条两端虚化的渐变地平线 + 从中央升起的椭圆暖光(日出),`OpeningScene` / `CharacterSelect` / `Conversation` 三个场景的按钮 / 卡片 / 输入框 `composes` 这个 class,输入框因 textarea 不渲染伪元素须套 `<div>` 包裹(WEB-202)。不动 `apps/web` 之外的文件、不动抽屉 / tweaks、不改设计数值、一 commit 一工单。
