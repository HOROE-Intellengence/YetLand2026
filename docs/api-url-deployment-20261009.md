# API 申请页连接地址修正

2026-10-09（America/New_York）发布 `api-url-20261009`。用户已确认 Chatbox 使用 `https://ingress.yetland.com/v1` 成功，本次统一申请页未登录默认值与登录后 `/api/developer` 返回值，并增加「复制连接地址」按钮。接口文档同步更新。

从本机构建并上传三个镜像：`yelan-api:api-url-20261009`、`yelan-web-caddy:api-url-cn-20261009`、`yelan-web-caddy:api-url-com-20261009`。API 基于上一版镜像，仅更新 developer 路由和共享 API 契约。前端按国内、备用入口分别构建。

本地检查：申请流程相关 11 项测试通过，变更文件 ESLint 通过；镜像内 API 类型检查、双前端生产构建通过。未重新提交模型生成请求。

线上核验通过：API 健康，原公众访问恢复；国内和备用首页实际引用的 JS 资源均含新地址和复制按钮文案，不含旧连接地址。既有合成验收账号调用 `/api/developer` 为 200，baseUrl 正确。用户已发布的提示词、revision、publishedId 及主模型/侧袋/四项任务/手机绑定均与本轮发布前备份一致。未进行浏览器剪贴板点击实测。证据在发布目录 `verification.json`、`deployment.json`。

停写备份及 SQLite quick_check 已验证。备份在 `/root/yelan-releases/images/api-url-20261009/backup`，发布包 SHA256 为 `bc9ac68814fc19746ae397493264465798a89094d8bdce850ad24e68a3dc5caa`。

回滚镜像和访问配置（保留当前数据）：

```sh
python3 /root/yelan-releases/images/api-url-20261009/api-url-deploy.py --rollback
```

采用 [夜阑运维 skill](C:/Users/linsh/.codex/skills/yelan-ops/SKILL.md)。
