# API 与小手机空回复修复发布记录

已上线并恢复国内及 COM 访问。完成时间：2026-10-13 03:04:07 America/New_York（07:04:07 UTC）。用户授权：“允许修复并上线”。

## 用户可见的结果

- 对外 API：上游 HTTP 200 却没有助手正文、工具调用或拒绝内容时，不再记为成功。JSON 返回 502 / UPSTREAM_EMPTY_RESPONSE；已经开启的 SSE 返回标准 error 事件和 DONE，并记录失败。
- 小手机后端：识别空 JSON、空 SSE、HTTP 200 内嵌错误和断流，返回明确错误并记录失败。
- 小手机前端：识别 SSE 标准 error；正文经过输出正则、线上思维标签、剔除文本后为空时抛出错误。正常文字、图片标记、显式静默及独立工具回合保留。
- 本次未增加自动重试；模型、Key、额度、提示词、用户文本规则及超时参数保留。

这次修复了上述空输出被当作成功的处理逻辑，不能消除供应商间歇性 429/500，也不能证明全部“无新消息”现象均由这些路径造成。已有页面刷新后加载新前端逻辑。

## 发布范围和镜像

Windows Docker Desktop 本机构建，linux/amd64，上传校验后部署。以正在运行的 phone-reader 镜像为基线，仅复制六个生产源文件（API 三个、手机三个），另重建两套手机 Next 产物。没有发布工作区的其他未提交改动。

| 服务 | 新镜像 | 回退镜像 |
| --- | --- | --- |
| API | yelan-api:empty-reply-20261013 | yelan-api:phone-reader-20261013 |
| 国内小手机 | yelan-phone:empty-reply-cn-20261013 | yelan-phone:phone-reader-cn-20261013 |
| COM 小手机 | yelan-phone:empty-reply-com-20261013 | yelan-phone:phone-reader-com-20261013 |

国内和 COM 主站镜像未替换。手机生产依赖沿用，Next 15.5.12；国内与 COM 构建 origin 分别保持 yetland.cn 和 ingress.yetland.com。

## 实际验收

- 59 项回归测试通过；API 和小手机 TypeScript 检查通过。
- 新 API 镜像 14 项隔离验收通过，包括空 JSON 502、空 SSE 错误、失败落库、正常回复、工具/拒绝输出、手机断流及不重试。上传后在服务器再次通过同一隔离验收。
- 两套实际手机镜像 12 项代理验收通过：JSON/SSE 正常回复、空回复错误、上游失败、心跳及鉴权。使用独立模拟后端，未向生产模型发送验收文本。
- 线上 API 与两套手机的六个源文件哈希吻合；两套编译产物包含新的空回复提示，origin 正确；API healthy，两个手机首页和认证握手均正常。
- 匿名及普通用户无法读取后台聊天/巡检记录；手机代理禁止后台路径；对外 API 仍要求 Key。语音配置读取通过。
- 维护阻断新流量，等待 processing 任务结束，停止涉及的三个容器后备份全部 _data（包含 SQLite WAL）。备份完整读验和 SQLite quick_check 通过。
- 在恢复流量前，全部 SQLite 表内容、数据库结构与 state.json 的指纹和切换前一致；主站镜像一致。原 Caddy 配置逐字节恢复。
- 独立复核四个公开入口 HTTP 200：yetland.cn、phone.yetland.cn、ingress.yetland.com、phone.yetland.com。

未进行用户浏览器完整聊天验收或真实手机设备验收；HTTP、镜像代理及编译产物检查不能代替这两项。

## 备份及回滚

服务器发布目录：/root/yelan-releases/images/empty-reply-20261013。

完整备份目录：/root/yelan-releases/images/empty-reply-20261013/backup（权限 0700）。包含 data.tgz、configuration.tgz、原始两套 Compose、原始 Caddyfile、旧镜像记录及数据库指纹。旧镜像保留。

镜像包 SHA256：f8d63eae67f1848eeb7564f437fc9020a136e5245183f5cb64de8ca500651995。

数据备份 SHA256：45da66876d8989bb5b5520985e652d1e1ef0472cce57188192033988dfff74eb。

服务器回滚命令：

```sh
python3 -u /root/yelan-releases/images/empty-reply-20261013/deploy.py --rollback
```

回滚脚本开启维护、等待任务结束、保留回滚前数据快照，恢复原镜像及 Compose，验证健康并恢复访问。本次没有数据库迁移，回滚保留上线后的业务写入，不覆盖当前数据库。

本地审计材料：[镜像与部署清单](D:/YL/.server/empty-reply-20261013/deployment.json)、[手机代理验收](D:/YL/.server/empty-reply-20261013/proxy-check.json)。源文件范围及哈希位于同目录 scope.json、source-hashes.json。
