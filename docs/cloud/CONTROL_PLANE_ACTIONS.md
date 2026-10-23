# Java 控制面经 GitHub Actions 发布

状态：本批新增受限发布器与隔离测试，服务器入口尚未安装；生产自动发布开关在完整链路验收前保持关闭。禁止从开发机 SSH；一次性安装由用户在服务器控制台完成，之后日常发布只走 Actions。

## 固定边界

```text
sudo -n /usr/local/libexec/flymind-control-plane-promote staging|production run-ID-attempt archiveSHA256
```

- 只认上述三个参数，不接受路径、service、SQL命令或环境覆盖。
- 从 `/etc/flymind/<环境>/control-plane-deployment.json` 读 root 私有配置。当前模板目标为 `/opt/flymind/control-plane/system-admin.jar`、`flymind-control-plane.service`；环境文件保持 `/etc/flymind/control-plane.env`，不覆盖。
- 与应用晋级使用同一 Actions run/attempt、Linux tar 和 SHA。发布器复制 incoming 档案后独立验 SHA、安全解包，复用受保护的 `verify-cloud-candidate.mjs` 核验完整 inventory、sourceCommit、releaseId、prepared/clean/OS/Node/ABI。不会执行候选 `ops`。
- GitHub run/branch/attempt 来源真实性由现 workflow/uploader 核验；root 发布器把传入 tar SHA、同包 manifest releaseId/sourceCommit 绑定到收据，不自行请求 GitHub 或信任额外未签来源文件。
- 控制面先发布且成功后才晋级应用。**不是跨栈原子事务**：若随后应用晋级失败，Java/已应用数据库迁移不会随 Node 自动回退。

## 自动备份与 schema 政策

1. 停 Java，确认 systemd MainPID 为0；不改 Node SQLite/制品。
2. 执行固定 root-owned、无参数 `backupHelper`。示例通过 MySQL 专用受限备份账号和 root 私有 `--defaults-extra-file`，执行一致性 dump + gzip完整性检查；不会把密码放命令参数、Actions日志或响应。
3. 发布器验证 helper成功、实际 root私有备份文件、长度/SHA、开始时间在本次停服后、完成时间新鲜；失败不替换JAR，尝试重启原服务。
4. 备份旧JAR，原子替换新JAR，写开始迁移标记再启动。私有收据保留 sourceCommit/run/SHA/JAR/DB备份摘要。
5. readiness 必须是 `/internal/flymind/readyz`：固定 loopback、禁止重定向、`X-FlyMind-Gateway-Key`、2.5秒请求预算、最多4096字节；须 `ready:true` 且 `jarSha256` 等于实际待发布JAR，不以 `/captcha` 或单纯HTTP200冒充成功。Java readiness另由 PM实现账户关系表/JDBC、Redis、ApplicationReadyEvent检查。

`allowedMigrations` 是本次已审候选JAR内 `BOOT-INF/classes/db/migration/*.sql` 的**原字节**文件名→SHA清单。增加、删除、修改任何迁移都在停服前拒绝；日常只改Java代码无需再批准。新增schema版本须另行审核并更新root策略，不能由上传账号或包内脚本更新。不要用Windows工作树SQL哈希代替实际候选JAR哈希（换行可能不同）。

首次默认 `rollbackPolicy:"stop-on-failure"`：旧线上JAR尚无新readiness，不能声称能自动验证恢复。新JAR尝试启动后失败则保持服务停服、写 `recovery-required.json`；后续发布拒绝直至管理员控制台核查。**不自动恢复MySQL**。后续旧/新JAR均支持精确readiness、迁移已审为向后兼容时，root可显式启用 `additive-compatible`，失败只恢复旧代码+当前数据库并重新验证；验证失败仍停服。

本helper只备份 MySQL，**不涵盖 Node SQLite、导出/导入制品或Redis**。Node应用继续现有独立备份/晋级政策，不可把Java备份称完整工作区备份。旧ID、团队、密码保留；禁止开启bootstrap或使用新账号种子。

## 一次性控制台安装

### 推荐：本次已核主机的一次安装器

`deploy/cloud/install-control-plane-actions.py` 只针对 OpenCloudOS 已核路径：Python `/usr/bin/python3` 3.11.6、Node `/opt/flymind/runtime/node-v22.23.3-linux-x64/bin/node`、`/usr/bin/mysqldump`、原forced-command `/usr/local/libexec/flymind-ssh-command.py`。不替换系统Python，不启动/重启服务，不改数据库/用户密码/authorized_keys，不开启Actions生产开关。

PM交接固定提交SHA、其GitHub源码archive SHA256、从该SHA成功Actions下载并审核的 `control-plane-runtime-evidence.json` 及原字节SHA256；用户无需复制secret。证据保持实际CI契约 `{schemaVersion:1,sourceCommit,jarSha256,allowedMigrations,verified:true}`，不伪造额外release字段。以下占位值由PM给出完整可复制命令：

```bash
# 只在服务器root控制台执行；不是开发机SSH。
umask 077
SOURCE_COMMIT=PM_APPROVED_40_HEX_COMMIT
SOURCE_ARCHIVE_SHA256=PM_APPROVED_ARCHIVE_SHA256
POLICY_SHA256=PM_APPROVED_EVIDENCE_SHA256
work=$(mktemp -d /root/flymind-cp-setup.XXXXXXXX)
curl --fail --proto '=https' --tlsv1.2 \
  "https://codeload.github.com/beidaomitu233/FlyMind/tar.gz/$SOURCE_COMMIT" -o "$work/source.tar.gz"
printf '%s  %s\n' "$SOURCE_ARCHIVE_SHA256" "$work/source.tar.gz" | sha256sum -c - || exit 1
tar --no-same-owner --no-same-permissions -xzf "$work/source.tar.gz" -C "$work"
# policy已由PM通过成功run官方artifact获取，放到root保护位置，不含secret。
/usr/bin/python3 "$work/FlyMind-$SOURCE_COMMIT/deploy/cloud/install-control-plane-actions.py" \
  --source-root "$work/FlyMind-$SOURCE_COMMIT" --source-commit "$SOURCE_COMMIT" \
  --policy-json /root/control-plane-runtime-evidence.json --policy-sha256 "$POLICY_SHA256"
```

默认复用现有 `flymind-deploy` 用户；若现有受限账号实际不同，由PM在上述唯一调用补 `--deploy-user 已核账号`，不能改为root。安装器只信root保护源码及祖先；源码archive固定SHA核验由上述控制台命令完成，脚本不会联网或调用Git。

安装器安全解析既有 `/etc/flymind/control-plane.env`，仅接受loopback、`fly_mind`与既有非root专用账号，生成root0600 MySQL CNF/readiness key/固定config，无source/eval、无secret输出。已有私有文件同字节复用，不同即拒绝且保留原文件。先暂存校验代码、`visudo -c/-cf`，再执行实际只读一致性dump并校验摘要；该账号权限不够则保护退出，**不自动扩大DB权限**。成功后才原子安装CP代码、同目录artifact helper、原forced-command及精确CP可执行文件sudo规则；失败回退自身代码替换，私有配置和备份保留root保护。参数限制仍由forced-command与root发布器同时严格校验，不增加通用shell/node/systemctl sudo权限。

同一证据/配置可重复执行；此安装只做一次，后续相同schema的代码更新走Actions。schema变更另审root迁移政策。非标准EnvironmentFile转义/多行、路径/权限/证据不符会明确拒绝，不猜测secret含义。输出仅固定诊断阶段：validate-source/private-config/dry-run-backup/install-dispatch/sudoers-check；不会输出子进程原始错误/SQL/环境值。

本地纯函数测试：`python tests/cloud-control-plane-install.test.py`，9项通过；覆盖env非执行解析、固定库、CI证据、root账号/外部地址拒绝、私有文件幂等与managed-code回退。测试使用临时文件，Windows夹具适配POSIX只读位；**未在本地执行root/systemd安装或真实dump**，实际控制台安装仍是待验收门槛。

以下分项手工说明保留作审计参考，正常使用上述一次安装器，无需逐文件填路径或复制secret。

由 PM 给出**已审提交的40位SHA和每个安装文件的SHA256**。以下命令只在服务器控制台运行；不索取腾讯扫码，不从开发机连接服务器。既有Node22、Python（`tarfile.data_filter`安全能力）、Java17、MySQL客户端与service先核对；不安装/升级现有数据库。

### 1. 固定来源与文件

在root控制台建立0700临时目录。从固定仓库 `beidaomitu233/FlyMind` 的精确提交下载下列文件，逐文件用PM给出的SHA校验后安装，**不能以main浮动地址直接执行，也不能从候选ops取root脚本**：

```bash
umask 077
work=$(mktemp -d /root/flymind-control-plane-install.XXXXXXXX)
# SOURCE_COMMIT 和下列文件SHA由PM交接，不能留占位值执行。
SOURCE_COMMIT=PM_APPROVED_40_HEX_COMMIT
curl --fail --proto '=https' --tlsv1.2 \
  "https://raw.githubusercontent.com/beidaomitu233/FlyMind/$SOURCE_COMMIT/deploy/cloud/control-plane-promote.mjs" \
  -o "$work/control-plane-promote.mjs"
# 对每个文件执行：printf '%s  %s\n' PM_FILE_SHA "$work/file" | sha256sum -c -
```

同样下载并核验：`scripts/verify-cloud-candidate.mjs`、`deploy/cloud/control-plane-promote-wrapper.sh.example`、`control-plane-backup.sh.example`、`control-plane-deployment.json.example`。然后：

```bash
install -o root -g root -m 0644 "$work/control-plane-promote.mjs" /usr/local/libexec/flymind-control-plane-promote.mjs
install -o root -g root -m 0644 "$work/verify-cloud-candidate.mjs" /usr/local/libexec/verify-cloud-candidate.mjs
install -o root -g root -m 0755 "$work/control-plane-promote-wrapper.sh.example" /usr/local/libexec/flymind-control-plane-promote
install -d -o root -g root -m 0700 /etc/flymind/production /var/lib/flymind/production/control-plane-deployments /var/backups/flymind/production-mysql
```

wrapper的Node绝对路径必须改为已供应的固定 **22.23.3**，不假设 `/usr/bin/node` 已满足。配置 `pythonExecutable` 和备份helper中的 `python` 必须同为已审核供应的Python3.11.6等具有 `tarfile.data_filter` / `hashlib.file_digest` 的实际绝对路径；**不要升级或替换系统Python**。发布器检查该文件/祖先root权限，允许标准可执行文件符号链接，但最终canonical目标/祖先也必须root保护。

脚本要求真实Linux root，仅测试入口不改变生产检查。所有祖先目录须root所有、不可被部署账号组/其它用户写入；JAR目录不可由flymind服务用户写入，JAR root所有0644供服务读取。保留原service/env；确认service无其他bootstrap覆盖。`/etc/flymind/control-plane.env`须0600且root所有。

### 2. DB备份与 readiness key

- 将备份示例复制到私有工作目录，**先把 `AUDITED_DB_NAME` 替换为已核对的实际库名（本次用户已确认 `fly_mind`）**，核对mysqldump路径；占位符未替换时脚本明确拒绝。安装为 `/usr/local/libexec/flymind-production-mysql-backup`，root所有0755。
- 在控制台用编辑器建立 `/etc/flymind/production/mysql-backup.cnf`（root0600），只用专用备份账号，非MySQL root；例如 `[client]` 下显式host/port/user/password。按实际数据库授予 dump必需权限，不给应用账号扩大权限；缺routines/events等权限时备份失败阻断，不删除参数伪造完整备份。
- `readinessKeyFile` 从既有env的 `FLYMIND_GATEWAY_KEY` 精确读取，不执行 `source`/eval。若值是单行未引用或单层引号格式，可用下述固定解析；复杂格式应由运维在控制台编辑器复制，不输出秘密：

```bash
/AUDITED_SUPPLIED_PYTHON/bin/python3 - <<'PY'
import pathlib,re,os
source=pathlib.Path('/etc/flymind/control-plane.env')
values=[]
for line in source.read_text().splitlines():
 m=re.fullmatch(r'\s*FLYMIND_GATEWAY_KEY\s*=\s*(.*?)\s*',line)
 if m:
  value=m.group(1)
  if value[:1] in ('"',"'"):
   assert len(value)>=2 and value[-1]==value[0]; value=value[1:-1]
  assert not any(c in value for c in '\r\n\\$`')
  assert 32<=len(value.encode())<=512
  values.append(value)
assert len(values)==1
fd=os.open('/etc/flymind/production/control-plane-readiness.key',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f: f.write(values[0]); f.flush(); os.fsync(f.fileno())
PY
```

### 3. 只批准本次候选迁移清单

PM从同一已验候选JAR用下列只读逻辑生成inventory，并核对该JAR在candidate manifest中的SHA；将清单交接给控制台，合入私有配置 `allowedMigrations`。生成命令不执行JAR：

```bash
# 路径只能是已完成archive SHA、manifest及sourceCommit核验的该run的JAR。
/AUDITED_NODE22/bin/node --input-type=module - /ROOT_PROTECTED_VERIFIED_CANDIDATE/control-plane/system-admin.jar <<'JS'
import {inspectJarMigrations} from '/usr/local/libexec/flymind-control-plane-promote.mjs';
console.log(JSON.stringify(await inspectJarMigrations(process.argv[2],undefined,'/AUDITED_SUPPLIED_PYTHON/bin/python3'),null,2));
JS
```

复制部署JSON模板并填完整inventory，固定既有端口、备份helper/key/env路径，保存 `/etc/flymind/production/control-plane-deployment.json` root0600；模板内占位哈希不能作为有效配置。可先在Actions候选生成后完成一次配置，日后同schema代码更新自动运行，不必每次人工批准。新增迁移才需要独立schema审核。

### 4. 受限入口和首次验收

由另一部署切片将精确 `flymind-control-plane-promote` 命令加入既有forced-command/sudo allowlist；仅固定入口、三个安全参数，不新增shell或通用sudo。安装须来自同一已审源码并核SHA；**当前旧服务器入口尚不具备该权限，不能绕过现有限制**。

先保持生产自动开关关闭，通过Actions受保护environment执行完整候选：Java发布成功→Node应用晋级→真实后台login/info/router、前台改密撤权、绘图/导出验证。完整通过才启用自动生产。无本机SSH、无Actions日志里的密码/token、无在线手动重置用户密码。

已有成功候选时，使用`Promote verified full-stack candidate`（`cloud-full-stack-promote.yml`），填写run_id、run_attempt和source_sha。该独立main工作流验证同仓库、精确run/attempt/commit、四项必需作业成功与main祖先关系，再下载原Linux包；不重复编译、不要求伪造staging。仍须`CLOUD_CONTROL_PLANE_DEPLOY=true`、production Environment及同一个production并发锁；不依赖自动生产开关。原双环境staging晋级流程保持原验证。自动生产只有完整初次发布验收后才开启。

## 故障与证据

- 每发布目录保留不可复用的attempt、原JAR、archive、完整candidate、backup/start-intent/result收据；同run+SHA成功重放必须当前JAR/健康仍一致，不重做备份或迁移。
- 有 `start-intent`但无成功结果、stale lock、失败/不兼容回退的recovery marker时，不通过新run盲重试。仅控制台管理员核查service/Flyway/数据库备份后解除；不可清文件假装成功。
- 自动流程不删除历史备份，不回滚数据库；磁盘容量/保留由显式运维策略管理。
- 本地隔离测试仅使用临时JAR/备份文件与注入service/健康/backup适配器；未运行真实systemd/mysqldump或连接服务器/生产数据库，首次Linux全链仍待控制台安装和Actions验收。
