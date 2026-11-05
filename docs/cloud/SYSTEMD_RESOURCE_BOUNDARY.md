# FlyMind 服务组内存边界（待安装和目标机验收）

仓库提供 `deploy/cloud/systemd/flymind.slice` 和三个服务的 `10-flymind-slice.conf`。它们是部署材料，不会随应用候选自动安装。`MemoryHigh=1000M` 是回收压力阈值，`MemoryMax=1024M` 为三个服务及其留在服务 cgroup 中的后代共同使用的硬上限；`MemorySwapMax=0` 禁止该组使用 swap。内核可在上限下终止任务，限额本身不保证绘图或发布成功。软阈值高于 1024−128 MiB，避免配置值与应用 128 MiB 压力线重合；两者采样和计量口径不同，不能保证一定先取消任务。

## 已知安装缺口

现有 Actions 受限 SSH 只允许调用已经安装的固定发布器；既不允许任意写 systemd 目录，也不允许任意 `systemctl`。应用包内的模板不会更新 root 发布器或 systemd。`install-compact-publisher.py` 固定旧的不可变来源和摘要，本次不得把未提交内容摘要填进去。需要先由管理员审定不可变制品，在 root 控制台一次性安装单元及 drop-in，或另行审定、安装仅允许固定操作的受限入口。本文不授权改变 sudoers 或远程 shell。

在目标机先确认 systemd、统一 cgroup v2 的 memory 控制器与 swap 控制均可用；核实单元名称、已有 drop-in、服务依赖、当前工作负载及足够的内存余量。检查内存压力限额对全部服务的可用性，并保留现有单元及 drop-in 的可恢复备份。若缺少控制器或无法验证实际生效，停止，不以配置文件存在代替硬限额。

在可信 root 控制台运行审定的 `deploy/cloud/install-resource-boundary.py --install`（需 Linux/Python 3 和 cgroup v2），脚本仅检查并创建以下固定目标，不接受用户指定路径、不覆盖未知同名文件、不运行 systemctl。它逐项同步文件及目录；中途中断可能留下部分新文件，应检查后重跑，未知内容或权限会拒绝。`--verify-files` 只核对文件，不修改；两者不证明限额运行中生效。目标 root 所有、0644；drop-in 目录 root 所有且不可被服务用户写入：

旧版 `896M` 文件与新文件不同，安装器会保守拒绝覆盖。升级已有安装须由管理员核对原文件并保留备份，按审定步骤原子替换 slice，再 reload 并核验实际 cgroup；不得以拒绝为由放宽未知文件检查。

- `/etc/systemd/system/flymind.slice`
- `/etc/systemd/system/flymind-application.service.d/10-flymind-slice.conf`
- `/etc/systemd/system/flymind-gateway.service.d/10-flymind-slice.conf`
- `/etc/systemd/system/flymind-control-plane.service.d/10-flymind-slice.conf`

管理员先将**审定后逐字节核对摘要**的安装器放在 root 私有目录，例如 `/root/flymind-resource-boundary/install-resource-boundary.py`；不要从未经审定的工作树或用户上传目录直接以 root 运行。确认三个原服务的实际名称及已有配置、目标机 cgroup 支持和回滚方案后，在 root 控制台执行：

```sh
python3 /root/flymind-resource-boundary/install-resource-boundary.py --install
python3 /root/flymind-resource-boundary/install-resource-boundary.py --verify-files
systemctl daemon-reload
```

这些命令不重启服务，已运行进程不会因为写入 drop-in 就安全地自动迁入。更新配置期间不声称总限额已经生效。

## 维护、发布和迁入的固定次序

先由运维人员启用并验证站点维护措施，阻止外部用户及 MCP 请求到达应用；保留原站点和配置，不清空用户数据。若不能在不影响其他站点的情况下阻断，停止发布。以下命令由 root 在维护窗口逐条执行；任一步报错、未完成排空或出现不明子进程时停止并保留现场，不执行后续发布和重启：

```sh
systemctl stop flymind-gateway.service
systemctl stop flymind-application.service
systemctl show flymind-gateway.service -p ActiveState -p MainPID -p ControlGroup
systemctl show flymind-application.service -p ActiveState -p MainPID -p ControlGroup
systemd-cgls --all
```

确认两个服务均 inactive、MainPID 为 0，且停服前记录的服务 cgroup 及其后代没有存活进程；`MainPID=0` 单独不足以证明排空。若 Java 需要本次迁入或升级，也按同样方式 `systemctl stop flymind-control-plane.service` 并确认其进程树退出；否则保持运行。此时才可通过原 Actions 入口处理已审核制品；不在低内存主机增加完整 staging。应用发布器会自行重启 app，因此**维护入口必须贯穿整次 Actions 发布，包括之后的 gateway 发布**；停掉 gateway 本身不能阻止浏览器直接请求 app。发布失败、锁/回执不确定或旧进程未退出时不要手动绕过锁或继续启动。

Actions 成功后，在维护窗口内确认 Java、app、gateway 的已审核版本及健康状态；如果某个服务因一次性迁入而保持停止，在确认发布状态和单写者安全后依次启动：

```sh
systemctl start flymind-control-plane.service
systemctl start flymind-application.service
systemctl start flymind-gateway.service
python3 /root/flymind-resource-boundary/install-resource-boundary.py --verify-live
```

检查完整后代及正常业务、保存、导出和回滚，再解除维护。Java 在发布之前已经运行时，`start` 不会重启它；如果它仍位于旧 cgroup，`--verify-live` 会拒绝，不能据此宣称迁入完成。发布操作和应用维护的实际互斥、全部进程内存以及故障处理仍需要隔离演练和现场核实。若无法确认旧进程退出、维护排空、数据库状态或服务恢复，保留现场并停止，不强行重启。

`--verify-live` 额外核对三个服务为 active、`Slice`、主 PID 的 cgroup 路径和父 cgroup 的三个实际限额；任何一项不能证实时拒绝。它并不枚举所有后代或发布器，因此不能单凭通过就认定全部 FlyMind 已受限。验收还应核对 `MemoryAccounting`，在受控子进程核对归属，并读取父 cgroup 的 `memory.current`、`memory.events`。服务重启、浏览器后代、导出 worker、故障恢复和高压下均需在隔离环境核验；不能只检查主 PID。遇到单元属性被更高优先级 drop-in 覆盖、后代逃离或读数不可用应拒绝验收。包括真实图形功能、正常排空、数据保存和回滚在内的 1 GiB 端到端验证仍是发布门槛。

## 发布期及磁盘边界

当前受限发布器由 SSH/sudo 会话启动，不会因这三个服务的 drop-in 自动加入 `flymind.slice`；发布器、解压、备份及其他临时进程的内存不受此父级限制。发布期必须进入维护状态、阻止新渲染并确认既有渲染及其子进程退出后，才能启动发布；首批不在低内存主机开启完整 staging。这个互斥要求需要现有维护机制和发布流程的实际端到端验证，本文不声称仅凭文档即可强制。共享 MySQL、Redis、Nginx、systemd 和内核其他部分同样不包含在该组内。故现有材料**尚不能证明发布期间所有 FlyMind 工作的 1 GiB 总硬上限**。需独立设计固定命令的受限发布执行入口，将整个发布进程树纳入同一父 cgroup，并验证超时、子进程关闭和 systemd 操作仍遵循锁及回滚合同；不得为此授予任意 `systemd-run` 或放松超时保护。

新版控制面发布器只在本次受锁保护的 attempt 已持久化成功回执、核验所有权和当前 JAR 等条件通过后，尽力删除本次 candidate 树及其副本压缩包；保留回执、上一 JAR、备份和任何失败/不确定现场。应用发布器在确认回执和锁安全后清理其本次私有临时归档。输入上传包、历史 release、未知锁和失败 attempt 不因这些材料而自动删除。以上逻辑仅存在于当前本地候选；旧服务器发布器是否具有该逻辑，必须按已安装的不可变版本独立核实。控制面清理失败不改变已确认发布结果，需单独记录，不能因此手动盲删用户数据或回滚材料。
