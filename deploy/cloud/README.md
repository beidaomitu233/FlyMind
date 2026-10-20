# 云端制品晋级：受限调度器与初始化边界

此目录是待目标机验证的 Linux 模板，**尚未部署服务器**。完整目标包括 Java 控制面、MySQL/Redis、独立 MCP 网关、绘图应用、管理端以及真正实时协作；本调度器只晋级 **绘图应用 + 与其同制品的 admin 静态文件**，不能称为全栈自动升级。

## 首次 SSH：先只读识别

确认实际 OS/CPU、Node路径/完整版本与ABI、systemd/Python版本、CPU/内存/磁盘、用户/UID、已占端口、现有服务/卷/备份、MySQL/Redis、TLS与反代。不得假定Ubuntu/x64，也不能把Windows node_modules或Chromium带到Linux。Python解压要求3.12+；制品必须在目标OS/架构/固定Node上安装生产依赖并实际通过固定Chromium sandbox/字体/五类PNG烟测，生成 `prepared:true` 后才能晋级。`verify-cloud-candidate.mjs` 默认要求干净来源、精确Node版本/ABI、完整清单及摘要。

## 一次性受控初始化（运维审核后执行）

这些是目录/权限要求，不是可直接运行的全栈安装脚本：

- `/opt/flymind`、`releases`、`current`父目录：root所有，通常0755，部署账号不可写；release内文件也不得group/world writable。完整上级路径必须允许flymind遍历。
- `dataRoot`：**预先创建为 `flymind:flymind`，0700**；模板为 `/var/lib/flymind/production/diagrams`。不能由晋级脚本递归创建成root:700。配置路径必须与application.env一致。
- `backupDirectory`、`stateDirectory`：预先创建root所有，0700，部署账号和应用均不可写；晋级脚本不会自动初始化这些目录。
- `/var/lib/flymind/incoming`：预先创建为独立上传账号所有，0700；账号仅上传候选，不属于root/Docker组，不得写发布根、配置、备份或服务文件。制品上限/磁盘配额另由主机配置。
- `/etc/flymind/<staging|production>/deployment.json` 与父目录：root所有、不可被上传者改写；env文件root私有0600，systemd读取后向服务注入。Java gateway key与账户/OAuth密钥不放candidate、Git或命令参数。
- 调度器由管理员**从审核后的源码**独立安装为 `/usr/local/libexec/flymind-promote.mjs`，同目录配套审核的 `verify-cloud-candidate.mjs`；root所有、不可被上传账号修改。固定 `/usr/local/libexec/flymind-promote` 入口采用root-owned小wrapper：`exec /usr/bin/node /usr/local/libexec/flymind-promote.mjs "$@"`（实际Node绝对路径先核对）。保留.mjs以免Node20把无扩展文件当CommonJS。不要以root运行候选包内的ops脚本。导入路径要求此配对文件相邻。
- sudoers只允许该固定调度器；调度器再次检查environment/releaseId/SHA，不授权任意node、systemctl、tar、shell、cp等命令。部署账号密钥在GitHub受限Environment secrets中，主机authorized_keys限制forwarding/PTY；不要赋予一般root shell。具体SSH限制配置由首次主机检查后确定。

固定调用：上传 `/var/lib/flymind/incoming/<releaseId>.tar.gz`，随后

```text
sudo -n /usr/local/libexec/flymind-promote <staging|production> <safeReleaseId> <archiveSHA256>
```

不能变更相同releaseId对应的字节。调度器仅固定参数、子命令无shell且不继承上传者PATH；可信标准PATH下的Python3须至少3.12。先以O_NOFOLLOW打开上传文件并复制到root私有随机临时文件，再对该副本流式校验SHA和解压，上传者后续改动原文件不会进入提取。提取使用Python data filter、数量/展开字节预算、禁止越界路径；随后校验每个文件/链接/未知文件及root权限，制品目录需可遍历、普通文件需可读，不能只通过root烟测而让服务账号打不开。现有Node依赖的包内链接只允许最终目标仍在制品内。

## 首次全栈装配不由dispatcher完成

1. 配置MySQL/Redis和Java生产账户，保留数据库独立备份；安装 `control-plane/system-admin.jar` 与其service/env到**独立受控位置**，不是current应用软链。执行Java安全、SQL、登录/OAuth/团队契约验证。
2. 安装准备好的Linux应用制品和受限application.service/env，确认固定资源/sandbox/readyz。
3. 独立安装网关到 `/opt/flymind/gateway/application`（模板路径），启动前应用readyz必须就绪。网关保持固定 `/mcp`、OAuth origin/audience；日常应用切换不重启网关。网关自身升级需单独排空、旧SDK session需重建。
4. 最后审查nginx/TLS模板，实际验证账户、team/权限撤销、双浏览器+AI、断线重放、PNG/下载与更新恢复。模板禁proxy buffering；长连接12分钟超时要与房间重连策略实测匹配。

Java/gateway二进制即使存在候选包，也**不会被promote自动安装或重启**。admin静态资源随current切换，必须维持与独立Java的向后兼容API。Java schema/Redis/数据库变更需要单独审核流程，不能把本调度器的migrationLevel当Java数据库迁移能力。

## 每次应用晋级与回退

- root私有部署锁拒绝并发；崩溃遗留锁不会自动抢占，管理员先核对PID、systemd、current、receipt后清理，不能盲删。
- 固定制品验证完成后 `systemctl stop`。模板 `KillMode=mixed` 先只发送SIGTERM给主进程，应用停止接新写、等已接受写/当前导出、发送房间reconnect、排出HTTP ACK，最后关闭浏览器和释放cloud数据根lease。`SendSIGKILL=no`，排空失败不得强杀并启动第二写者。
- MainPID必须0后才备份。数据根与current/state/backup/release等路径必须互不包含；备份拒绝任何symlink，离线复制整个dataRoot（含SQLite及其WAL/SHM/导出文件）。备份root私有，原稿不删。备份不涵盖外部Java/MySQL/Redis。
- 用同目录rename原子换current软链，再启动应用；readyz必须为目标releaseId。端口监听不等于就绪。
- 失败时先停新应用并确认无主PID，再切回旧**代码**并用当前数据启动；只允许相同migrationLevel，且要求发布者保证该level内存储可向后读取。这不是所有跨版本回退的充分证明，升级前必须有实际回退烟测。
- **不会自动恢复旧DB备份**，以免覆盖新应用已确认的写入；若需数据恢复必须再停写、人工审批并保留当前数据/未确认客户端草稿。首次安装没有旧代码时失败会停新服务，等待修复，不凭空恢复。
- receipt/失败日志保留在stateDirectory，包含备份位置、切换和回退结果；不是完整业务审计。清理旧制品/备份需另设保留策略，不能删仍被current/gateway/待导出任务引用的供应。

## 定向验证

`node --test tests/cloud-deployment.test.mjs` 覆盖纯配置约束、字节/清单篡改、未知类型、根/链接越界。脚本导入不会执行promote。没有在Windows模拟systemd或声称Linux权限、Python解压、真实停机/回退已验收；这些须目标机staging进行。全栈自动流水线与不可变包烟测由PM集成。
