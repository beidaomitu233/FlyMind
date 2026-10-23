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

## 故障与证据

- 每发布目录保留不可复用的attempt、原JAR、archive、完整candidate、backup/start-intent/result收据；同run+SHA成功重放必须当前JAR/健康仍一致，不重做备份或迁移。
- 有 `start-intent`但无成功结果、stale lock、失败/不兼容回退的recovery marker时，不通过新run盲重试。仅控制台管理员核查service/Flyway/数据库备份后解除；不可清文件假装成功。
- 自动流程不删除历史备份，不回滚数据库；磁盘容量/保留由显式运维策略管理。
- 本地隔离测试仅使用临时JAR/备份文件与注入service/健康/backup适配器；未运行真实systemd/mysqldump或连接服务器/生产数据库，首次Linux全链仍待控制台安装和Actions验收。
