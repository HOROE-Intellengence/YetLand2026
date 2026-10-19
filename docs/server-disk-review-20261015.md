# 服务器磁盘优化复核 — 2026-10-15

## 执行结果（后续已授权）

2026-10-15 06:17 America/New_York，用户明确允许删除这 19 个服务器重复包后，已执行完成。下文保留原只读复核和计划，执行结果以本节为准。

- 删除前重新验证本地与服务器全部 19 个文件 SHA256；检查当前容器、挂载、Compose 镜像引用与复核基线一致，候选文件无其他进程占用。
- 仅删除清单中的 19 个普通文件，全部确认不存在；本地对应副本保留。
- 实测可用空间增加 13,380,784,128 字节（12.4618 GiB），可用约 22.4736 GiB。`df -h /` 显示已用 53G、可用 23G、使用率从 87% 降至 71%；百分比向上取整，略高于原计划约 70% 的估算。
- 58 个 Docker 镜像 ID 集合完全不变；13 个容器的 ID、镜像、状态、启动时间、健康状态完全不变，没有停服或重启。
- 主站首页仍为 HTTP 200；社区、论坛、社区小手机仍为门禁跳转 HTTP 303，与执行前一致。本次未重复进行完整浏览器对话验收。
- 清单之外的已盘点归档文件均仍存在且大小不变；数据备份、配置、卷和所有业务数据未列入删除范围。
- 未清理构建缓存、日志、Docker 镜像或停止容器，未执行任何 prune。

逐文件回执：`.local/community-prototype/disk-audit-20261015/delete-receipt.jsonl`；汇总：`delete-summary.json`；执行后清单：`executed-archive-plan.json`；保留归档检查：`preserved-archives.json`。原 `verified-archive-plan.json` 保留为删除前审批依据。

以下为执行前只读复核记录。

## 结论

推荐第一批只删除已经逐文件校验的 19 个服务器重复镜像归档，合计 13,380,636,576 字节，即 12.4617 GiB（13.3806 GB）。本地副本全部保留。暂不删除任何 Docker 镜像，已足够达到此前释放约 10GB 的目标。

盘点时根盘总量 84,151,820,288 字节，已用 69,747,912,704 字节，可用 10,750,226,432 字节（10.0119 GiB），df 显示使用率 87%。按候选文件逻辑大小估算，执行后可用约 22.4736 GiB，使用率约 70%。实际释放量需执行后用 df 复测；磁盘保留块、并发写入及计量单位会影响显示值。

## 已完成的复核

- 读取全部 13 个容器（10 个运行、3 个停止或未启动）的镜像引用与挂载路径。
- 读取 58 个本地镜像的 ID、标签和层列表；读取当前 Compose 及备份 Compose 的镜像引用，未输出环境变量或密钥。
- 盘点相关发布目录的镜像归档与数据备份，逐项区分。
- 为 19 个候选归档找到唯一同大小本地副本，分别完整读取本地与远程文件并计算 SHA256，19/19 完全一致。
- 校验候选不是符号链接，实际路径位于指定发布目录；19 个文件均不位于任何容器挂载路径内。读取 tar 首成员，均为镜像归档的 blobs 目录。
- 复核账号整合回滚脚本与 10 月 13 日空回复修复的回滚记录，确认需额外保留的历史镜像。
- 没有重新 docker load 全部归档，也没有进行停服恢复演练；哈希一致证明副本一致，不替代完整灾备恢复验收。

## 第一批清单：只删除远端重复归档

以下大小统一使用 GiB。精确字节数、SHA256 和对应本地路径见本地私有机器清单。

| 服务器文件 | GiB |
| --- | ---: |
| `/root/yelan-releases/dialogue-acceptance-20261009/live-final-turn-r2-20261009.tar.gz` | 0.29 |
| `/root/yelan-releases/dialogue-acceptance-20261009/live-final-turn-20261009.tar.gz` | 0.29 |
| `/root/yelan-releases/images/yelan-chat-fix-d3a439c.tar` | 1.66 |
| `/root/yelan-releases/images/yelan-image-settings-953195b.tar` | 0.29 |
| `/root/yelan-releases/images/yelan-api-2f13d36.tar` | 0.29 |
| `/root/yelan-releases/images/yelan-phone-20261007-c68ffa1.tar.gz` | 1.18 |
| `/root/yelan-releases/images/phone-update-20261009-cb0ce1e/images.tar.gz` | 1.65 |
| `/root/yelan-releases/images/voice-repairs-20261012/api-r2.tar.gz` | 0.29 |
| `/root/yelan-releases/images/voice-repairs-20261012/images.tar.gz` | 0.32 |
| `/root/yelan-releases/images/pagination-20261010/pagination-images.tar.gz` | 0.29 |
| `/root/yelan-releases/images/conversation-reader-20261010/conversation-reader-images.tar.gz` | 0.29 |
| `/root/yelan-releases/images/phone-inspection-20261009-cb0ce1e/images.tar` | 1.66 |
| `/root/yelan-releases/images/email-voice-20261009-cb0ce1e/images.tar.gz` | 0.32 |
| `/root/yelan-releases/images/admin-voices-20261012/images.tar.gz` | 0.33 |
| `/root/yelan-releases/images/api-url-20261009/api-url-images.tar.gz` | 0.32 |
| `/root/yelan-releases/images/api-alias-20261009/api-alias-images.tar.gz` | 0.32 |
| `/root/yelan-ingress-20261008/frontends-com.tar` | 0.90 |
| `/root/yelan-ingress-20261008/phone-stream.tar` | 0.88 |
| `/root/yelan-ingress-20261008/frontends.tar.gz` | 0.90 |

删除这些归档不会卸载已经加载的镜像，也不会改变容器文件系统。历史部署脚本若需要再次 load 这些包，需先从记录的本地路径上传回原位置并重新核对 SHA256；这项恢复成本需保留在发布记录中。

第一批不删除归档所在目录，保留其中的部署脚本、源文件清单、配置、回执和所有 backup 目录。

## 明确保留

- 所有运行、停止及未启动容器，以及它们引用的镜像。尤其不删除 `community-test-bridge`、旧 `yelan-api` 和 `yelan-caddy`：它们有历史回退用途。
- 账号整合回滚需要的 `yelan-web-caddy:community-entry-cn-20261015`；`yelan-api:empty-reply-20261013` 同时仍由密码门禁和旧 bridge 引用。
- 空回复修复回滚需要的 `yelan-api:phone-reader-20261013`、`yelan-phone:phone-reader-cn-20261013`、`yelan-phone:phone-reader-com-20261013`；其备份 Compose 中还引用 `yelan-web-caddy:admin-voices-cn-20261012`。
- `/root/yelan-releases/images/empty-reply-20261013/images.tar.gz` 和 `/root/yelan-releases/images/phone-reader-20261013/images.tar.gz`：本轮保留近期镜像归档。
- 两个 `yelan-community-*-20261015` 发布目录的归档、代码、配置和数据，本轮均保留。
- 正式 `_data`、统一社区 `state`、旧社区数据、论坛 Redis、论坛上传文件、证书卷、所有数据/配置备份。
- `.env`、门禁配置、Caddy 配置、账号、聊天记录及其他业务数据。

## 其他操作的可行性

| 项目 | 复核结论 | 本轮建议 |
| --- | --- | --- |
| 构建缓存 | Docker 报告 1.367GB 总量、868.9MB 可回收；清理后重建需重新生成缓存 | 可作为第二批；执行前排除正在构建的任务，收益约 0.81GiB，不纳入第一批估算 |
| 未引用镜像 | Docker 汇总报告 5.324GB 可回收，但包含明确需保留的回滚镜像；共享层和 containerd 计量不能简单相加 | 暂缓，不承诺实际可释放量；必须另做具体镜像 ID 白名单 |
| 系统日志 | journald 占约 677.3MB | 收益小，暂不删除历史；后续设置合理保留上限 |
| Docker 日志轮转 | 主要容器未配置显式轮转 | 属于防增长配置；新配置应用到现有容器通常需要重建容器，应另安排窗口 |
| 容器和数据卷 | 停止容器存在回退用途，业务数据卷体积远小于镜像 | 全部保留，不使用 container/volume/system prune 或 down -v |
| 小手机镜像瘦身 | 当前社区镜像约 8.39GB；容器内 .next 约 1.1GiB、node_modules 818MiB、public 158MiB，仅为部分目录大小 | 有明显优化空间，但属于后续构建和发布任务，不与本轮清理混做 |

## 镜像膨胀根因与后续方案

10 月 13 日等窄范围发布为了保留线上基线，以旧 `yelan-phone` 镜像为 FROM，重新构建并 COPY `.next`。在新层中 `rm -rf .next` 只遮蔽旧内容，不能从父镜像层回收旧产物。每次更新新增约 1.1GB 产物层，形成 4.35GB → 5.69GB → 7.02GB → 8.39GB 的版本体积增长。

仓库已有多阶段 Dockerfile，但最终阶段复制整个应用目录；后续应基于固定、可复现的线上源文件集合，从干净运行时镜像开始，只复制经过验证的运行必需文件。不能直接重建当前脏工作区，把其他未提交修改带上线。是否采用 Next standalone 还须核对自定义 `local-next-server.mjs`、代理、静态文件及动态依赖，不能直接替换启动方式。

瘦身验收应包含三个入口的 origin/握手、静态资源、账号、资源消费、SSE 与已有异常处理；先在本机完成，再按单独授权部署。最终能省多少，需以新镜像体积和移除旧层后的 df 为准。

## 后续第一批执行步骤

1. 读取 `verified-archive-plan.json`，重新核对本地副本存在且 SHA256 一致。
2. 刷新容器、挂载、当前发布和回滚引用；确认计划未过期，无部署/镜像加载任务占用候选文件。
3. 对服务器文件重新核对绝对路径、普通文件类型、大小、SHA256；任一不一致即停止，不扩大范围。
4. 按清单逐个删除服务器上的 19 个普通文件，记录每项结果。禁止递归删除发布目录、通配删除或一键 prune。
5. 对比 df 与容器 ID、镜像 ID、状态、健康检查；检查主站及社区门禁响应。预期无需停服或重建。
6. 保存执行回执。若需恢复某个旧包，从对应本地路径上传回原位置，核对哈希；不恢复或覆盖业务数据。

## 本地证据

证据目录：`D:\YL\.local\community-prototype\disk-audit-20261015\`，已确认被 Git 忽略。

- `inventory.py` / `inventory.json`：只读盘点脚本和脱敏容器、镜像、挂载、归档、Compose 镜像引用。
- `local-archives.json`、`archive-candidates.json`：本地归档索引和候选匹配。
- `hash-remote.py`、`local-hashes.json`、`remote-hashes.json`：双端 SHA256 证据。
- `verified-archive-plan.json` / `.csv`：19 项精确路径、大小、哈希和本地恢复来源；状态均为 `verified_duplicate_not_deleted`。
- `docker-df.txt`：Docker 细分用量原始记录。

本报告不包含账号、令牌或密钥。只有本地审计文件与此报告被创建。
