# 开放 API 模型名称部署与实测

2026-10-09（America/New_York）本机构建、上传并部署版本 `api-alias-20261009`。服务器未执行全量源码构建。国内与备用入口恢复原有公众访问规则。

## 发布范围

- API：`yelan-api:api-alias-20261009`，以线上 `live-final-turn-r2-20261009-cb0ce1e` 为基础，仅覆盖网关转发、服务、路由及共享 API 契约四个文件。
- 国内主站：`yelan-web-caddy:api-alias-cn-20261009`。
- 备用主站：`yelan-web-caddy:api-alias-com-20261009`。
- 小手机镜像未替换；主模型、侧袋、四项任务及小手机绑定与发布前一致。
- 申请页提供 `yetland_opus_5_5_pure`、`yetland_opus_5_5_plus` 复制按钮，删除原 Gemini 介绍。模型列表按 Key 版本返回对应公开模型；JSON/SSE 的模型元数据使用公开名称，旧上游模型名请求仍兼容。

## 实测

用户提供的 Key 为高级版。最初对话返回 `503 PRELUDE_NOT_PUBLISHED`；核对线上 revision 0 草稿与项目初始规则仅换行格式不同后，通过既有管理发布接口发布为版本 1，未改写规则。该失败发生在调用受理与上游请求之前。

| 检查 | 结果 |
| --- | --- |
| 国内、备用入口模型列表 | HTTP 200，仅返回 `yetland_opus_5_5_plus` |
| 备用入口 `/models/` | HTTP 200，no-store |
| 真实 JSON 对话 | HTTP 200，`YETLAND_OK`，约 5.56 秒 |
| 真实 SSE 对话 | HTTP 200，`YETLAND_OK`，约 4.14 秒，有 `[DONE]` 和 usage |
| 两次调用模型名称 | 均为 `yetland_opus_5_5_plus` |
| 每次调用用量 | 输入 1684、输出 5，共 1689 tokens |
| 高级 Key 请求纯净模型 | HTTP 404，未调用上游 |
| 两次记录落库 | succeeded，advanced，promptVersion=1，token 用量一致 |
| 双入口首页与资源 | 首页 HTTP 200；部署资源含两个公开模型名、复制按钮文案，无原 Gemini 介绍 |
| 本地回归 | 网关 31 项通过；前后端类型检查及变更文件 ESLint 通过；镜像内部 API 类型检查及双前端生产构建通过 |

本轮只用该高级版 Key 发出两次真实模型请求；纯净版由自动测试覆盖，未创建额外 Key。浏览器工具打开备用域名被客户端阻止，未完成页面按钮点击验收；资源检查不等于浏览器交互验收。本机直连国内域名 TLS 失败，但服务器通过正常 TLS 的 curl 已验证国内首页和模型列表均为 200。用户 Key 未保存进脚本、镜像或报告。

## 备份与回滚

短暂维护期间停写 API，完整持久目录归档读取校验和 SQLite quick_check 均通过。备份：`/root/yelan-releases/images/api-alias-20261009/backup`，含数据、部署配置及 Caddy 证书卷。原镜像保留。

发布包 SHA256：`11290f20ad1d1566eb4e5cd3e738b795e5457e8daf1e64379113895fba0a1c7a`，上传后核对一致。

回滚代码与两套前端（保留上线后数据及已发布规则版本 1）：

```sh
python3 /root/yelan-releases/images/api-alias-20261009/api-alias-deploy.py --rollback
```

实测请求 ID：`d6e3f3ee-801d-45e2-8bbe-ad215debd022`、`ca685bc2-9933-48dc-90ab-3633ecb40228`。内部报告位于服务器该发布目录的 `live-report.json`、`final-checks.json`、`deployment.json`，本机 `.server/api-alias-live-report.json`。

采用 [夜阑运维 skill](C:/Users/linsh/.codex/skills/yelan-ops/SKILL.md)。
