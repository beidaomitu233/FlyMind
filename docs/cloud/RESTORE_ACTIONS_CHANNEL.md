# 恢复原有受限 Actions 发布入口（待人工审核）

本清单针对已完成首次安装后的空白发布入口，不执行操作、不恢复任何私钥、不调整业务数据库或迁移。先确认现有服务、数据库和备份，再由管理员单独审核固定来源和 SHA；不能从上传的 candidate `ops` 执行 root 代码。若服务器已有未知目标文件或锁，停止并保留现场。

## 共同入口及应用发布

所有目标及祖先 root 所有且不被部署账号写入；下列执行入口 0755，`.mjs` 0644：

| root 安装目标 | 已审源码 / 内容 |
|---|---|
| `/usr/local/libexec/flymind-ssh-command.py` | `deploy/cloud/ssh-command.py` |
| `/usr/local/libexec/flymind-promote.mjs` | `deploy/cloud/promote.mjs` |
| `/usr/local/libexec/materialize-candidate.mjs` | `deploy/cloud/materialize-candidate.mjs` |
| `/usr/local/libexec/verify-cloud-candidate.mjs` | `scripts/verify-cloud-candidate.mjs` |
| `/usr/local/libexec/flymind-promote` | 固定 wrapper，见下 |

wrapper 只包含 `#!/bin/sh` 和下一行：

```sh
exec /opt/flymind/runtime/node-v22.23.3-linux-x64/bin/node /usr/local/libexec/flymind-promote.mjs "$@"
```

`/etc/flymind/production/deployment.json` 沿用仓库 `deploy/cloud/deployment.json.example` 的全部字段，`publicOrigin` 改为 `https://fly.hui7.fun`，`applicationOrigin` 保持 `http://127.0.0.1:5192`，其他路径与目标服务器核对一致。`/var/lib/flymind/incoming` 必须供独立 `flymind-deploy` 账号专用、0700；首次安装助手创建的 root 私有空目录只有确认无使用、无内容后才可调整所有权。业务 `diagrams` 保持 `flymind:flymind` 0700，发布 state 与备份保持 root 私有。

`/etc/sudoers.d/flymind-app` 为 root 0440，仅授权以下固定命令；先 `visudo -cf` 校验独立文件，再 `visudo -c` 校验整体。不要给 Node、systemctl 或通用 shell 授权：

```text
flymind-deploy ALL=(root) NOPASSWD: /usr/local/libexec/flymind-promote production run-* *
```

管理员确认后，仅将已核对的 Actions 公钥以 `restrict,command="/usr/local/libexec/flymind-ssh-command.py"` 前缀安装到该账号受保护的 `authorized_keys`。保留其他已审条目，验证 SSH StrictModes，禁密码、PTY、端口/代理转发、SFTP 和其他可取得 shell 的密钥；Actions 私钥仍只在原 Environment secrets。恢复前先核对 Actions 开关，避免密钥恢复后未计划的自动晋级。

## Java 控制面

另安装 root 0644 `/usr/local/libexec/flymind-control-plane-promote.mjs`，来源 `deploy/cloud/control-plane-promote.mjs`；复用上面的 verifier 和 materializer。root 0755 `/usr/local/libexec/flymind-control-plane-promote` 的固定 wrapper 如下：

```sh
#!/bin/sh
exec /opt/flymind/runtime/node-v22.23.3-linux-x64/bin/node /usr/local/libexec/flymind-control-plane-promote.mjs "$@"
```

`/etc/sudoers.d/flymind-control-plane` 为 root 0440，沿用原权限范围，分别允许固定入口的 production 与 staging `run-* *`，不得开放其他命令；forced command 和发布器仍独立核参数。单环境生产不需要建立同机 staging 服务。

root 私有 0600 `/etc/flymind/production/control-plane-deployment.json` 的字段以 `control-plane-deployment.json.example` 和已审 `install-control-plane-actions.py` 为准：固定 incoming、`/var/lib/flymind/production/control-plane-deployments`、`/var/backups/flymind/production-mysql`、`/opt/flymind/control-plane/system-admin.jar`、`/etc/flymind/control-plane.env`、`/etc/flymind/production/control-plane-readiness.key`、`/usr/bin/python3`、`/usr/local/libexec/flymind-production-mysql-backup`、`flymind-control-plane.service`、`http://127.0.0.1:18080` 和 `rollbackPolicy: stop-on-failure`。`allowedMigrations` 必须来自**实际审核 JAR 内原字节**的 11 项文件名和 SHA，并与既有批准清单逐项核对；不能仅凭当前源码、表数量或包自带清单自动批准变更。

readiness key 为 root 0600，值与现有 Java gateway key 一致；`/etc/flymind/production/mysql-backup.cnf` 为 root 0600，使用已经存在的 loopback 数据库、专用非 root 备份账号；不能把凭据放入命令行或日志。root 0755 `/usr/local/libexec/flymind-production-mysql-backup` 从已审 `control-plane-backup.sh.example` 固定 `/usr/bin/python3` 和已核实数据库名生成，不能接受调用方指定数据库。备份先存临时 SQL 再 gzip，需足够磁盘；只读一致性 dump 的成功、完整性、权限及不会修改现有 33 表仍需现场核验，且该备份不涵盖 Node 工作区或 Redis。

仓库的一次性 `install-control-plane-actions.py` 可辅助，但其硬编码 Python 3.11.6、Node 22.23.3、loopback 数据库 `fly_mind`、非 root 专用账号、关闭 bootstrap 及 root 私有来源等严格前置必须逐项满足。它会执行一次真实只读数据库 dump 并安装代码与 sudoers；与“仅准备、不执行”有区别，不能跳过条件或伪造 CI evidence。环境或数据库名不符就停止并单独审核，不能擅自扩权限。

## 网关与传输

root 0644 `/usr/local/libexec/flymind-gateway-promote.mjs` 来源 `deploy/cloud/gateway-promote.mjs`；root 0755 `/usr/local/libexec/flymind-gateway-promote` 的 wrapper 固定运行同一 Node 与该文件。`/etc/sudoers.d/flymind-gateway` root 0440，仅允许 `flymind-deploy ALL=(root) NOPASSWD: /usr/local/libexec/flymind-gateway-promote production run-* *`。网关发布复用 app config、锁与 verifier；目标须为已就绪的 app 当前 release，且其 app `.prepared.json` 的包 SHA 匹配。手工首次安装不会自动产生该发布回执。

采用原 `bytes` 模式时不需要 HTTPS artifact helper；仅有显式审核的 HTTPS 模式才额外安装 `artifact-fetch.py` 和精确域名 allowlist。既有静态 `install-compact-publisher.py` 固定旧 commit、旧 baseline/SHA，不能直接在重建主机当新版本安装器，也不能混填新文件摘要。

恢复完成后在隔离和维护窗口验证上传 SHA、应用/Java/网关固定参数、错误参数与 shell/SFTP/转发拒绝、失败锁/回执、真实回滚与数据保护。Actions 正常顺序是 Java → app → gateway，三个操作不是跨栈原子事务；发布前须阻止渲染，维持维护直到整个流程结束。发布器由 SSH/sudo 启动，尚不属于 `flymind.slice`；需单独核实发布时总资源，不能仅凭服务 slice 宣称全部进程受 1 GiB 硬上限保护。以上清单没有在目标机执行。
