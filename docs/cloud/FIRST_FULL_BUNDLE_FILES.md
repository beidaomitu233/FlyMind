# 首次完整包文件准备（未执行）

`deploy/cloud/install-first-full-bundle.py` 是空主机的一次性文件准备助手：不写私有环境文件、不启动服务、不操作数据库、不配置站点或 SSH，也不构建或运行 smoke。它保守拒绝已有 FlyMind 数据、release、链接、三个 systemd 服务单元或已加载服务；已先行安装的 slice/drop-in 须由资源安装器逐项核对完全一致。失败后保留已创建现场，不自动清理或覆盖。

管理员先确认机器和所有待创建目标无现存或正在使用的 FlyMind 资源、服务和子进程，并核对当前备份及回滚方案。已存在的 MySQL/Redis 和其他站点不得删除或重置。准备独立 `flymind` 系统用户及同名非 root 组，预装、校验 Linux Node 22.23.3 至 `/opt/flymind/runtime/node-v22.23.3-linux-x64/bin/node`，确认 Java 和目标机 Chromium 依赖。确保可用磁盘足够同时容纳源候选及目标副本；复制逐文件进行，不将整包读入内存。

本批已有可信 root 所有 `/var/backups/flymind`，其中历史备份保持原样。助手仅新建 `/var/backups/flymind/u40-20261105` 及其中私有的 `production`、`production-mysql`，若新目录已存在则拒绝；不会更改父目录权限或删除历史备份。管理员须将后续 app 的 `backupDirectory`、Java 的 `backupDirectory` 与固定 MySQL 备份 helper 分别配置为新子目录中的 `production`、`production-mysql`；原示例路径不能直接照抄。

管理员在 root 私有且祖先目录均不可被非 root 写入的位置准备：

- 经平台验收的完整 Linux prepared candidate 解压目录（包含 `candidate.json`、`application`、`control-plane`、`admin` 和 `ops`），以及从可信制品记录独立核对的 `candidate.json` SHA-256；不能用 Windows 包或仅有 `prepared` 字样代替验收。
- `/root/flymind-install/verify-cloud-candidate.mjs`：来自已审定、不可变版本的 verifier，独立核对字节摘要。助手以固定 Node 运行它，并要求 root 所有/非组及其他用户可写，分别验证源目录和复制结果、文件 SHA、prepared、平台/Node/ABI；不要从未经验证的候选内执行 verifier。
- `/root/flymind-install/install-resource-boundary.py`：本次审定并校验摘要的资源边界安装器；事先已安装好其固定 slice/drop-in。助手在写入其他内容前运行 `--verify-files`，最终幂等运行 `--install`，不会覆盖未知文件。
- 同样审定并核对摘要的本助手；以上脚本及祖先目录均须 root 所有且不可被组或其他用户写入。不要将未经审定的候选代码作为 root 执行。

使用当前审定的实际绝对路径和可信摘要，root 控制台人工执行（示意值须替换）：

```sh
python3 /root/flymind-install/install-first-full-bundle.py /root/verified-candidate ACTUAL_64_CHARACTER_LOWERCASE_MANIFEST_SHA256
```

成功仅表示文件已准备：完整包复制到 `/opt/flymind/releases/<releaseId>` 并复验，current 和 gateway 指向该 release，Java JAR 已复制；三个 systemd 服务、父 slice、drop-in 和独立目录已创建。原候选、历史数据和外部服务不会被自动删除。`/var/lib/flymind/incoming` 此时 root 私有，不能用来假装 Actions 上传通道已恢复；后续受限通道须另行审定。

随后由管理员单独配置 root 私有的 `/etc/flymind/control-plane.env`、`/etc/flymind/production/application.env` 和 `gateway.env`，参考包内现有模板，三个 gateway key 一致，JWT/数据库凭据单独生成且不打印。确认固定域名 `https://fly.hui7.fun`、回环端口、数据库隔离和现有宝塔站点路由，勿覆盖原站点。先检查配置、独立空库和备份策略，再由管理员有序 `systemctl daemon-reload` 并启动 Java、app、gateway；验证 `/readyz`、身份、数据、浏览器 sandbox、完整功能和 [资源边界](SYSTEMD_RESOURCE_BOUNDARY.md) 的 live cgroup。启动及真实用户验收不属于此助手，不能以文件准备成功冒充上线成功。
