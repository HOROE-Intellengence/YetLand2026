# 小手机预览、素材留存和移动端 UI 合并发布

部署完成时间：2026-10-19T04:24:00Z。用户已明确授权将同时完成的手机端 UI 一起上线。执行 yelan-ops 的本机构建、上传校验、短维护、一致性备份、API 先行、三端小手机更新及入口验收流程。

## 上线行为

- 后台小手机巡查以手机画面预览完整留存内容，可打开完整图片、播放已留存音视频、阅读文本/JSON 及下载附件；按用户、类型与记录检索。
- 用户素材进入管理员素材库，显示来源、文件体积及关联巡查记录。图片大于 2 MiB 时先降低质量、必要时缩尺寸，以 WebP 保存至不超过 2 MiB；较小图片、音视频及其他资源保留原字节。
- 新手机首次打开重新补传设备尚存的内容；历史缺失的文件不会凭空恢复。只保留缩略图的旧生成图继续注明缺失原文件。后台预览保持只读。
- 合并手机端自适应满屏、44px 触控区域、16px 输入、聊天字号与弹层滚动、虚拟键盘视口调整；社区移动端增加底部导航与安全区布局。真实手机软键盘、麦克风及外部模型生成未在本轮重测。
- 修复 Next 默认请求体克隆截断大图的问题；实际 17 MB 上传验证完整转发。修复共享社区手机未开启巡查、被普通社区 100 KB 上限误拦截的问题；普通社区提交仍保持原限制。
- 历史 82 个极小 SVG 无法生成缩略图时保留原文件，显示可下载提示，不丢弃资源。

## 部署范围与数据核验

| 容器 | 新镜像 | 精确镜像 ID |
| --- | --- | --- |
| `yelan-release-api` | `yelan-api:phone-material-ui-20261018` | `sha256:e78d037252a69a7dea99a0e38c433b0145bba72e9f775efff50cba83b855e0b7` |
| `community-test-phone` | `yelan-phone:phone-material-ui-community-20261018` | `sha256:dfd5c980e3d9dbfa3ab542bb562af0e2543f16b1560e93a3d06223383f388f68` |
| `yelan-release-phone` | `yelan-phone:phone-material-ui-cn-20261018` | `sha256:e93c8016eddd18d2282b30c00150e06a5fe29e8bf3b7cce0f640dd353efc7c7f` |
| `yelan-ingress-phone` | `yelan-phone:phone-material-ui-com-20261018` | `sha256:db87d25623386de00624fc3d40b829396985175412fed6d1637ec48a26fcb46e` |

以各端当时运行的镜像为基线，仅覆盖已核对的功能和 UI 文件。没有整体发布脏工作区。四个预期容器以外的容器 ID 保持一致；未启动旧独立社区 API。持久 Caddyfile 未修改，临时维护结束后运行态配置逐字段还原，社区门禁保持原状。

备份目录：`/root/yelan-phone-material-ui-20261018/backup`（服务器，0700）。包含停写后的 API 全量持久目录、社区共享 SQLite、论坛 Redis RDB/配置/上传文件、现行 Compose/环境/门禁配置及证书数据。归档完整解压读取校验，文件另有 SHA256 回执。敏感配置不复制到报告。

部署前后账号 919 个、角色 103 个，账号/角色、模型及图像配置逐字段一致；六个社区表完整内容散列一致。聊天 calls、巡查 records/previews 内容及行数在补录和重启后散列一致。

历史素材补录回执：

```json
{
  "apply": true,
  "assets": 334,
  "bytes": 15540068,
  "chatImageReferences": 51,
  "uniqueChatImages": 10,
  "recoveredChatImages": 10,
  "unreadableCalls": 24,
  "failedAssets": 0,
  "linkedResources": 286,
  "libraryTotal": 389,
  "addedMaterials": 344
}
```

另有 24 份历史请求已无法解析，未尝试补造；原请求记录保留不变，`failedAssets=0` 表示已识别资源补录没有失败。

“可可”对应 `usr_9e10d02d`，没有发现由已知测试脚本创建的证据，不能认定为测试账号。此次生产验收确认其用户上传素材已至少补入 3 张完整图片。后台素材总数 389，用户上传素材 10；这些是部署验收时点快照。

## 验收与访问状态

| 入口 | 验收 HTTP 状态 |
| --- | --- |
| yetland.cn | 200 |
| phone.yetland.cn | 200 |
| ingress.yetland.com | 200 |
| phone.yetland.com | 200 |
| community.yetland.cn | 303 |
| phone.community.yetland.cn | 303 |

国内及 COM 主站/小手机入口均返回 200；社区入口保持门禁跳转。COM 预检时曾返回 Cloudflare 403，本次部署后验收为 200，原边缘访问配置已精确还原。

实际镜像运行验收覆盖图片压缩、非图片逐字节一致、完整归档、管理员权限、用户隔离、旧列结构写入兼容、私网抓图拒绝、社区能力凭证与原提交限额；三端代理验证 2 MB 附件和 17 MB 图片无截断、超限拒绝及管理路径隔离。相关回归合计 44 项、11 文件通过；API、后台、小手机类型检查和四个生产镜像构建通过。

生产验收：四个镜像 ID 与清单一致，重启计数为 0；管理员能读取完整素材文件，匿名和普通用户读取返回 401；既有合成验收账号 bootstrap/语音配置接口正常。未调用真实模型、未新增合成业务记录。浏览器通过临时只读代理仅展示既有合成验收账号，真实管理员凭证不进入浏览器，代理验收后关闭。

该生产合成账号没有巡查/素材记录，因此生产浏览器只验收空状态和筛选控件；完整聊天/图片/播放器的浏览器效果使用前述本地合成样例验证，生产完整文件读取另经真实 API 检查。直接打开小手机显示原有主站进入提示，未将此计为登录后实际聊天 UI 验收。

![生产后台既有合成验收账号的素材库空状态](../.server/phone-material-ui-20261018/deployed-materials.png)

## 回执与回滚

本机回执位于 `.server/phone-material-ui-20261018/`：`manifest.json`、`archive.json`、`deployed.json`、`verification.json`、`backfill-plan.json`、`backfill.json`、`runtime-results.json`、`local-candidates.json`。

上传归档 SHA256：`10968332032e772914bd33e82946efd32e3f895c18b3be559209b43bebd2d08e`。

若需回退，先确认没有后续部署，再在服务器执行 `python3 /root/yelan-phone-material-ui-20261018/ops.py rollback`。脚本重新维护、备份回退时的当前数据、恢复旧镜像和 Compose 并保留当前业务数据，最后还原原访问状态。未执行线上回滚演练，不用旧数据快照覆盖上线后的新增用户内容。

容量边界及本地合成验收详情见 [实现记录](phone-material-preview-implementation-20261018.md)。
