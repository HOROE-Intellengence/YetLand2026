# API 页赞助文案部署

2026-10-10（America/New_York）发布 `sponsor-20261010`。

将“版本由 Key 决定。”替换为“接口由鸿绒云赞助”；鸿绒云使用暗金色 `#b89a63`，新窗口链接到 `https://horoe.com`。

本机基于线上 `api-url-cn-20261009` / `api-url-com-20261009` 镜像提取静态文件，仅定点替换该段 JSX 编译产物并追加对应 CSS，生成新资源文件名和首页引用；源码同步保存在 ApiScene.tsx / ApiScene.css。未将工作区其他未发布改动带入。镜像为 `yelan-web-caddy:sponsor-cn-20261010`、`yelan-web-caddy:sponsor-com-20261010`。本机 JavaScript 语法检查通过，上一轮源码类型检查通过。

上传包 SHA256 校验通过后，仅重建国内 caddy 和国际 web 服务。API、手机、数据、访问规则未变更，无需停写数据库。Compose 备份已逐字节校验，旧镜像保留。

国内与国际公网首页均 HTTP 200，实际引用的新 JS/CSS 已逐一下载，确认新文案、链接、颜色存在且旧文案不再出现。API 容器保持 healthy。未进行浏览器视觉与点击验收。

备份：`/root/yelan-releases/images/sponsor-20261010/backup`。
证据及脚本：同目录的 `deployment.json`、`verification.json`、`deploy.py`。
本地发布目录：`D:\YL\.server\sponsor-20261010`。

回滚（保留当前业务数据）：

```sh
python3 /root/yelan-releases/images/sponsor-20261010/deploy.py --rollback
```

使用 [夜阑运维 skill](C:/Users/linsh/.codex/skills/yelan-ops/SKILL.md)。
