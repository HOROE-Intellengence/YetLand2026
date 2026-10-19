# 本地社区原创内容批次 20261015

32 项：12 张角色卡、6 套独立世界书（各 10 条）、6 套无壁纸配色主题、4 篇教程、4 篇管理员讨论。所有初始版本为 `1.0.0`。正文与 JSON 是可编辑真理源；`manifest.json` 记录稳定内容标识、用途、来源及配套关系。没有外站采集、付费模型、生图或语音调用。

只操作 `http://localhost:3038`、`4567`、`3041` 的隔离原型。管理员是作者，另一位版主独立审核资源，成员 A 安装验收，成员 B 仅作隔离读回和拒绝检查。教程和讨论用管理员真实身份，通过正常 NodeBB Write API 发帖；管理员发帖按现有权限直接发布，不伪造成普通用户待审稿。没有点赞、回复或互动填充。

## 运行与恢复

从 `D:\YL` 运行；依赖使用仓库已有安装，不安装或升级包。

```powershell
# 首次写入前，完整备份本地目录、SQLite 在线快照及相关持久卷；保持服务运行
node prototype/community/content/batch-20261015/backup.mjs
# 按当前真实 Zod schema 校验所有 JSON，检查 100000 字节请求上限
node apps/api/node_modules/tsx/dist/cli.mjs --tsconfig apps/api/tsconfig.json prototype/community/content/batch-20261015/validate.ts
# 先发布三类各一项
node prototype/community/content/batch-20261015/import.mjs --pilot
node prototype/community/content/batch-20261015/verify-install.mjs --pilot
node apps/api/node_modules/tsx/dist/cli.mjs --tsconfig ai-virtual-phone/tsconfig.json prototype/community/content/batch-20261015/verify-prompt.ts
# 真实手机浏览器三类试点验收后继续；同账号等待限流窗口，不提高配额
node prototype/community/content/batch-20261015/import.mjs
# 审核审计有最近 150 条展示上限，安装批次前保存发布证据
node prototype/community/content/batch-20261015/collect-evidence.mjs
node prototype/community/content/batch-20261015/import-posts.mjs
node prototype/community/content/batch-20261015/verify-install.mjs
# 六套手机浏览器验收完成后，恢复原启用主题并生成最终交付表
node prototype/community/content/batch-20261015/restore-consumer.mjs
node prototype/community/content/batch-20261015/report.mjs
```

`build-content.mjs` 保存最初原创编辑源。JSON/Markdown 允许直接编辑，已有编辑后不要再次生成覆盖。已经发布的资源如需改变，沿用清单中的资源身份，改文件与清单版本号后重新校验、导入；工具会走新版本草稿、提交、他人审核和同步。相同版本远端与文件不同会停止，要求显式升版本。不要删除回执后用重投稿代替更新。

断点恢复：重跑原命令即可。工具先查询作者已有资源与版本；即使创建成功后回执写入中断，也按唯一标题、类型和完整字段校对恢复。资源使用本地 `key → resourceId → version → tid` 记录，论坛帖使用唯一标题分页查询并核对原始正文。不要并行运行多个导入器。论坛正文修改后工具会发现与服务器不同并停止，需人工决定修改原帖；不会复制新帖凑数。

限流：固定同一管理员账号，24 个新资源共需至少两个 10 分钟窗口。每次尝试写入前保存时间，等待采用最长 60 秒一段；429 继续等待。必要的 bridge 重启也保留本地投稿时间，避免利用重启清掉内存限流。同步每 2.5 秒查询，最多等待两分钟；未成功则记录原因，下次先查询状态。同步失败不自动改数据库，可由管理员按现有工作台重试。

## 回执与隐私

会话、身份、详细审计、安装 ID、运行回执和备份索引均在 `.local/community-prototype/`，该目录已被 Git 忽略。请勿复制到 Git 或共享。内容目录只包含原创内容、工具、脱敏验收摘要与截图。备份中包含本地密钥，应按敏感备份保存。

未启动、停止、重建论坛；不运行会停启论坛的 `check-operations.mjs`，不执行 `down -v`。仅阻塞验收的人设映射做了本地 bridge 小修复：小手机消费已编译的角色字段与禁忌表达，排除备注中的安装标记。生产入口和持久资源均不改写。详见 `acceptance.md`。

## 浏览器验收重做

1. 社区选成员 A，打开“我的资源”，确认角色、世界书绑定、主题版本。
2. 仅从社区“进入小手机”。底栏“角色”（人像图标）→“联系人”→目标角色→“编辑”，核对世界书与常驻选项。
3. 底栏“主题”（调色盘图标）→“主题色”，核对页面、卡片与输入框颜色；不同页面使用变量范围不同。
4. 在社区“我的资源”启用另一主题，再重新进入；“恢复应用主题前的外观”也需重新进入。手机中手改某个颜色并“应用”，重复进入同一状态应保留；恢复应保留手改项。
5. 此环境未连接模型，不发送真实对话、生图或语音请求。`evidence/prompt-assembly.json` 只证明组装，不能当模型输出证据。
