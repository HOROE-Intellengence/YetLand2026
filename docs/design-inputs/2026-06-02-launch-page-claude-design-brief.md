# Claude Design Brief: 夜阑启动动画与初始页优化

> 目的：把当前真前端启动动画和初始页提取成一份可直接交给 Claude Design 的设计输入。请只优化 `apps/web` 的启动体验，不改业务流。

## 1. 项目语境

- 产品名：夜阑。
- 类型：深夜情绪陪伴 / 角色对话 SPA。
- 前端栈：React 18 + Vite + TypeScript + CSS Modules + Zustand。
- 设计气质：夜色、烛火、星图、东方玄秘、低声对白；不要做成通用 SaaS、游戏大厅或营销落地页。
- 当前启动链路：
  - `scene = intro`：播放启动动画。
  - `IntroScene` 自动或点击跳过后调用 `goOpening()`。
  - `scene = opening`：展示初始问候选择页。
  - 点击问候后 `setGreeting(greeting)`，进入 `name` 场景。
  - 点击“我已经有账号”进入 `login` 场景。

关键源码：

- `apps/web/src/App.tsx`
- `apps/web/src/stores/sessionStore.ts`
- `apps/web/src/scenes/IntroScene.tsx`
- `apps/web/src/scenes/IntroScene.module.css`
- `apps/web/src/scenes/OpeningScene.tsx`
- `apps/web/src/scenes/OpeningScene.module.css`
- `apps/web/src/styles/globals.css`
- `apps/web/src/styles/tokens.css`
- `apps/web/src/styles/horizon.module.css`

## 2. 当前启动动画现状

文件：`apps/web/src/scenes/IntroScene.tsx`

动画结构：

- 全屏黑底，`z-index: 20`，点击任意处跳过。
- `phase` 状态驱动整段动画。
- 时间线：
  - 120ms：phase 1，烛芯 / ember 点亮。
  - 1700ms：phase 2，星图与涟漪出现。
  - 3300ms：phase 3，法阵 sigil 出现。
  - 5600ms：phase 4，火花爆发、烛火出现。
  - 7400ms：phase 5，品牌标题“夜阑”出现。
  - 9800ms：phase 6，淡出。
  - 10400ms：进入 opening。
- 点击跳过：立刻进入 phase 6，500ms 后进入 opening。

视觉元素：

- ink wash canvas：大面积径向墨色/冷暖光晕。
- star map：随机星点，金色、冷蓝、纸色，使用 `starTwinkle`。
- ember：中心烛芯脉冲。
- ripples：中心圆形涟漪扩散。
- sigil：SVG 法阵，多层圆环、刻度、七芒星、中心 seal，持续旋转。
- sparks canvas：phase 4 粒子爆发。
- petal bursts：径向光瓣爆发。
- candle flame：中心烛火。
- title：SVG 文字“夜阑”，下方 `Y E L A N` 和 `· 夜 未 央 ·`。
- skip hint：底部“点击跳过”。

当前判断：

- 优点：视觉资产足，品牌识别强，启动动画有仪式感。
- 问题：动画长达 10.4 秒，信息密度偏满；inline style 太多，视觉难统一；进入 `OpeningScene` 后落差明显，像从电影硬切到菜单。
- 重点：不要删掉“烛火 / 星图 / 夜阑题字”的记忆点，但需要把节奏、层次和首屏衔接优化得更高级。

## 3. 当前初始页现状

文件：`apps/web/src/scenes/OpeningScene.tsx`

当前内容：

- 标题：`夜阑`
- 副标题：`夜深了。这里没有算法，只有一段等着你的对白。`
- 四个问候按钮：
  - `今晚，想和谁说话？`
  - `有些事，只想说给一个人听。`
  - `夜还长，慢慢来。`
  - `又见面了。`
- 主入口：`直接进入`
- 次入口：`我已经有账号`

样式现状：

- `root` 是全屏居中 flex column，`gap: 40px`。
- 标题 / 副标题 / 按钮组用 `fadeUp` stagger。
- 按钮使用 `horizonField`：底部发光地平线 + 中央暖光。
- 色彩使用 tokens：黑夜背景、纸色文字、金色光。

当前判断：

- 优点：文字方向是对的，问候语符合产品氛围。
- 问题：排版太“菜单化”；没有承接上一段启动动画的星图/烛火/法阵残影；问候按钮权重相近，用户不知道该怎么选；“直接进入”和“我已经有账号”视觉层级比较粗。

## 4. 设计目标

请优化启动动画和初始页的整体体验，目标是：

1. 降低启动动画的拖沓感，让 10 秒动画可被设计为“完整观看很美，快速跳过也自然”。
2. 让 `IntroScene -> OpeningScene` 有连续感，不要像两个不相干页面。
3. 初始页要更像“进入夜阑的一扇门”，不是按钮列表。
4. 保留品牌核心符号：夜阑、烛火、星图、微光、深夜对白。
5. 保留现有业务流：问候选择、直接进入、已有账号登录。
6. 移动端和桌面端都要成立；不能出现文字重叠、按钮溢出、中心视觉压住可交互区域。

## 5. 约束

技术约束：

- 仍然使用 React + CSS Modules。
- 不引入新的大型动画库。
- 可以建议拆分组件，但不要改变 Zustand 的核心场景状态机。
- 可以建议把 inline style 下沉到 CSS Module，但不要把任务扩大成全站重构。
- `ParticleField` 当前是空 canvas，不要依赖它已经有粒子实现。
- 当前 `@yelan/web` typecheck 已通过。

业务约束：

- 不要删除“我已经有账号”入口。
- 不要强制登录。
- 不要把初始页做成营销 landing page。
- 不要改后续 `NameScene`、`CharacterSelect`、`Conversation` 的业务语义。

审美约束：

- 避免大面积紫蓝渐变、廉价玄幻光效、通用 AI 产品风。
- 避免过度卡片化。
- 避免把所有东西都做成按钮；初始页应该像仪式和选择，而不是后台表单。
- 保持克制、黑夜、纸色、金色微光。

## 6. 希望 Claude Design 输出什么

请输出一份可交给前端实现的设计方案，包含：

1. 启动动画节奏重排建议：保留哪些 phase，压缩/合并哪些 phase，推荐总时长。
2. `IntroScene -> OpeningScene` 转场设计：如何让标题、烛火、星图或地平线残留到初始页。
3. 初始页布局方案：桌面和移动端分别描述。
4. 交互层级：问候选项、直接进入、已有账号三者怎么摆、怎么弱化/强化。
5. 视觉 token 建议：颜色、字号、间距、动效时长，不需要写完整 CSS，但要足够具体。
6. 可实现性备注：哪些可以小改完成，哪些属于后续增强。

## 7. 可直接复制给 Claude Design 的 Prompt

你是 Claude Design。请基于下面的现有前端启动页信息，设计一次“启动动画 + 初始页”的高级化优化方案。

产品叫“夜阑”，是深夜情绪陪伴 / 角色对话 SPA。当前气质是夜色、烛火、星图、东方玄秘、低声对白。不要做成 SaaS、游戏大厅或营销页。

当前技术栈是 React 18 + Vite + TypeScript + CSS Modules + Zustand。启动链路是：

- `scene='intro'` 渲染 `IntroScene`
- `IntroScene` 播放 10.4 秒动画，或点击跳过
- 结束后调用 `goOpening()`，进入 `OpeningScene`
- `OpeningScene` 展示标题、文案、四个问候按钮、“直接进入”、“我已经有账号”
- 问候按钮调用 `setGreeting(g)` 进入 `name`
- 登录按钮调用 `goLogin()` 进入 `login`

现有 `IntroScene` 包含：ink wash canvas、随机星图、中心 ember、涟漪、SVG 法阵、多层旋转圆环、sparks canvas、光瓣爆发、中心烛火、SVG 题字“夜阑”、`Y E L A N`、`· 夜 未 央 ·`、底部“点击跳过”。动画 phase 时间线：120ms / 1700ms / 3300ms / 5600ms / 7400ms / 9800ms / 10400ms 进入 opening。

现有 `OpeningScene` 文案：

- 标题：夜阑
- 副标题：夜深了。这里没有算法，只有一段等着你的对白。
- 问候：
  - 今晚，想和谁说话？
  - 有些事，只想说给一个人听。
  - 夜还长，慢慢来。
  - 又见面了。
- 入口：
  - 直接进入
  - 我已经有账号

当前问题：启动动画有记忆点但偏长、偏满；`OpeningScene` 太像按钮菜单；两者之间转场断裂，像电影硬切到表单。请保留“夜阑 / 烛火 / 星图 / 微光 / 深夜对白”的核心符号，优化为更高级、更克制、更连贯的启动体验。

请输出：

1. 启动动画节奏重排建议，包含推荐总时长。
2. `IntroScene -> OpeningScene` 的连续转场设计。
3. 初始页桌面端和移动端布局。
4. 问候、直接进入、已有账号的交互层级。
5. 颜色、字号、间距、动效时长等可落地 token 建议。
6. 分阶段实现建议：小改可完成项 vs 后续增强项。

请不要建议引入大型动画库，不要要求重写业务状态机，不要删除已有账号入口，不要强制登录。

