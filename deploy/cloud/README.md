# 云端制品晋级：受限调度器与初始化边界

2026-10-23最新约束：后续统一GitHub Actions，停止本机直接SSH/扫码部署。本批已实现独立Java受限发布器、真实JAR/MySQL/Redis构建门槛及显式完整栈模式；旧服务器入口尚待一次性控制台安装，线上尚未更新。执行说明见[控制面安装](../../docs/cloud/CONTROL_PLANE_ACTIONS.md)，方案与验收步骤见[发布台账](../../docs/cloud/ACTIONS_CONTROL_PLANE_ROLLOUT.md)。下方旧promote仍只更新application/admin，不能把旧入口当已具备完整栈升级。

此目录是待目标机验证的 Linux 模板，**尚未部署服务器**。完整目标包括 Java 控制面、MySQL/Redis、独立 MCP 网关、绘图应用、管理端以及真正实时协作；本调度器只晋级 **绘图应用 + 与其同制品的 admin 静态文件**，不能称为全栈自动升级。

## 首次 SSH：先只读识别

确认实际 OS/CPU、Node路径/完整版本与ABI、systemd/Python版本、CPU/内存/磁盘、用户/UID、已占端口、现有服务/卷/备份、MySQL/Redis、TLS与反代。不得假定Ubuntu/x64，也不能把Windows node_modules或Chromium带到Linux。Python解压要求 `tarfile.data_filter` 安全能力（支持含安全回移植的Python3.11.6等版本），仍强制 `extractall(filter='data')`；制品必须在目标OS/架构/固定Node上安装生产依赖并实际通过固定Chromium sandbox/字体/五类PNG烟测，生成 `prepared:true` 后才能晋级。`verify-cloud-candidate.mjs` 默认要求干净来源、精确Node版本/ABI、完整清单及摘要。

## 一次性受控初始化（运维审核后执行）

这些是目录/权限要求，不是可直接运行的全栈安装脚本：

- `/opt/flymind`、`releases`、`current`父目录：root所有，通常0755，部署账号不可写；release内文件也不得group/world writable。完整上级路径必须允许flymind遍历。
- `dataRoot`：**预先创建为 `flymind:flymind`，0700**；模板为 `/var/lib/flymind/production/diagrams`。不能由晋级脚本递归创建成root:700。配置路径必须与application.env一致。
- `backupDirectory`、`stateDirectory`：预先创建root所有，0700，部署账号和应用均不可写；晋级脚本不会自动初始化这些目录。
- `/var/lib/flymind/incoming`：预先创建为独立上传账号所有，0700；账号仅上传候选，不属于root/Docker组，不得写发布根、配置、备份或服务文件。制品上限/磁盘配额另由主机配置。
- `/etc/flymind/<staging|production>/deployment.json` 与父目录：root所有、不可被上传者改写；env文件root私有0600，systemd读取后向服务注入。Java gateway key与账户/OAuth密钥不放candidate、Git或命令参数。
- 调度器由管理员**从审核后的源码**独立安装为 `/usr/local/libexec/flymind-promote.mjs`，同目录配套审核的 `verify-cloud-candidate.mjs`；root所有、不可被上传账号修改。固定 `/usr/local/libexec/flymind-promote` 入口采用root-owned小wrapper：`exec /usr/bin/node /usr/local/libexec/flymind-promote.mjs "$@"`（实际Node绝对路径先核对）。保留.mjs以免Node20把无扩展文件当CommonJS。不要以root运行候选包内的ops脚本。导入路径要求此配对文件相邻。
- sudoers只允许该固定调度器；调度器再次检查environment/releaseId/SHA，不授权任意node、systemctl、tar、shell、cp等命令。部署账号密钥在GitHub受限Environment secrets中，主机authorized_keys限制forwarding/PTY；不要赋予一般root shell。具体SSH限制配置由首次主机检查后确定。

自动化密钥必须配置 `restrict,command="<root-owned ssh-command.py绝对入口>"`，仅 `restrict` 仍可能得到shell，不能作为充分隔离。PM管理的固定dispatch只接受 `flymind-upload <safeReleaseId> <archiveSHA256>`（stdin二进制，最多2,000,000,000字节，核SHA后原子写入固定incoming）及下述原有promote命令；不允许shell/SFTP/SCP。Node uploader使用 `ssh -T` 流式stdin，不再调用scp。

固定调用：通过 `flymind-upload` 将候选保存为 `/var/lib/flymind/incoming/<releaseId>.tar.gz`，随后

```text
sudo -n /usr/local/libexec/flymind-promote <staging|production> <safeReleaseId> <archiveSHA256>
```

不能变更相同releaseId对应的字节。调度器仅固定参数、子命令无shell且不继承上传者PATH；可信标准PATH下的Python3须提供 `tarfile.data_filter`。先以O_NOFOLLOW打开上传文件并复制到root私有随机临时文件，再对该副本流式校验SHA和解压，上传者后续改动原文件不会进入提取。提取使用Python data filter、数量/展开字节预算、禁止越界路径；随后校验每个文件/链接/未知文件及root权限，制品目录需可遍历、普通文件需可读，不能只通过root烟测而让服务账号打不开。现有Node依赖的包内链接只允许最终目标仍在制品内。

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

## 单环境线上测试与双环境二选一

当前 `fly.hui7.fun` 首次落地采用单环境线上测试：PM完成独立控制面/网关/TLS bootstrap及目标机固定供应检查后，受控首次production晋级无需伪造staging记录。详见 [首次部署审查](FLY_FIRST_DEPLOYMENT.md)。

- 单环境：仓库 `CLOUD_AUTO_PRODUCTION=true`、`CLOUD_AUTO_STAGING` 不为true。main push的source/platform全部成功后，production job从同run下载已冻结Linux包，经production Environment中的受限部署账号执行uploader，`cloud-production`并发锁与手动晋级共享。无需人工SSH逐次更新；Environment审批为运维可选策略。
- 双环境：关闭自动production，另设隔离端口/service/current/dataRoot后启用 `CLOUD_AUTO_STAGING=true`；保留既有 `cloud-promote.yml` 同一成功staging包手动晋级。不能在同机同数据/同端口同时开启两模式。
- 两变量同时true时，staging被禁用，production在取包/SSH之前检查失败，避免两份dispatcher并发操作同一实例。PR及非main不进入自动production。
- 原手动生产workflow仍要求staging成功，不能用于单环境首次bootstrap。单环境首次由PM已授权受控调度器执行；后续main走自动production，不删除原手动workflow的来源检查。

本次离线定向：`tests/cloud-deployment.test.mjs`配置与文件校验4/4，workflow本地YAML解析及job依赖/环境/并发检查；未执行GitHub远端pipeline或服务器命令。目标OpenCloudOS、Node绝对路径、Python及sandbox验证由PM真实部署收口。


## 可审的 HTTPS 制品数据通道（尚未启用）

当前首包已由PM通过原受限入口晋级；GitHub runner 到服务器的大包SSH传输慢，自动生产开关目前关闭。以下新增通道只有代码及本地验证，**真实签名URL传输、服务器安装与重新启用仍待授权/PM验收**，不把实现等同已上线。默认 `DEPLOY_TRANSPORT=bytes` 保留原通道；仓库变量 `CLOUD_ARTIFACT_HTTPS=true` 才令生产/staging工作流选择 `artifact-https`。不要同时开启两个环境操作同一数据根。

- CI仍下载、核对tar的SHA，然后用只读 `tar -xOzf ... ./candidate.json`（2MiB输出预算）读取已验生产者releaseId/sourceCommit。失败job重跑的 `run_attempt` 不再覆盖旧制品的ID；同run但源commit或prepared/platform不符拒绝。原手动生产工作流的staging/成功run来源校验不删除，也不伪造首次staging成功。
- 仅部署job获得 `actions:read`，通过固定GitHub API核对当前仓库、run、main commit、唯一Linux artifact及官方ZIP摘要。CI账号token仅发给 `api.github.com`，不会给存储主机、服务器或放入命令参数。下载接口手动读取302/303 Location，不自动携带Authorization跳转。GitHub文档说明下载URL一分钟过期；每次失败最多再申请一次新URL，URL只在内存中经SSH stdin传输，不落盘/输出。来源：[GitHub REST artifacts](https://docs.github.com/en/rest/actions/artifacts#download-an-artifact)。
- 管理员单独审核并将 `ssh-command.py` 与相邻 `artifact-fetch.py` 安装在root-owned不可被部署账号写入的固定目录。forced command新增精确 `flymind-fetch <releaseId> <tarSHA256>`，仍以部署用户执行，无新增sudo/root能力；随后复用原固定promote。模块加载时校验helper及其祖先root所有、无symlink/组或其他写权限。
- 精确主机列表放root-owned `/etc/flymind/artifact-download.json`，其祖先也不可被部署账号写入，普通文件不可是symlink。示例为 [artifact-download.json.example](artifact-download.json.example)，只含私有HEAD记录曾见的存储**主机名**，不含URL/query。CI请求不能指定/扩展allowlist；GitHub切换存储主机时需管理员重新审核配置，失败即停。
- 接收metadata上限16KiB，字段固定，时间窗60秒。生产仅允许配置中的HTTPS443主机，拒用户信息/fragment/控制字符，DNS每个结果都须为公网；连接固定已核IP并保留TLS证书/SNI主机校验，不读取代理环境、不跟随任何服务端redirect。纯测试的localhost opener仅由测试代码注入，不存在请求或环境开启方式。
- 外层ZIP最多2,000,000,000字节，要求官方ZIP SHA及长度一致；ZIP恰含 `flymind-linux-x64.tar.gz` 和其`.sha256`，拒重复/额外/路径/目录/符号链接/加密/未知压缩方法。只流读这两成员，**不执行ZIP extractall**。sidecar最多256字节，tar最多2GB，流式核长度与SHA。下载及展开各600秒预算，socket20秒超时；私有临时目录失败即清理，核验后以hardlink原子发布incoming。原root promote仍复制到root私有文件后完整验tar、candidate清单/权限、排空、备份、切换和回退，不因新通道放宽。
- 新通道磁盘需额外容纳ZIP与tar（最多约4GB，另计root verifier/展开/备份）；本次不做磁盘扩容或自动清理旧发行版。同releaseId仅允许相同SHA复用。真实Linux权限、原子发布与跨网传输需要PM后续目标机验收，本地Windows测试不代替该证据。

定向命令：`node --test tests/cloud-artifact-source.test.mjs tests/cloud-deployment.test.mjs`（8/8），`python tests/cloud-artifact-fetch.test.py`（4/4，本地回环假源；无真实token/签名URL）。覆盖manifest重跑身份、固定API凭据边界、URL/DNS拒绝、ZIP摘要/成员预算、302拒跟及双层摘要链。沙箱首次junction/回环因系统权限拒绝，按相同测试获准本地执行后全过；未执行服务器操作、完整构建或绘图探针。
