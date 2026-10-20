# fly.hui7.fun 首次测试部署：离线落地审查

2026-10-20，DEPLOY-FLY-01。仅审查仓库及已由PM提供的服务器盘点信息；本代理没有连接服务器、运行远程命令或修改现有数据。

## 已知条件与现有代码

- 目标为OpenCloudOS9.6、4GB RAM（当时可用约1GB）+3GB swap；宝塔Nginx已占80/443，已有MySQL/Redis/Java。Node未进PATH，但存在 `/www/server/nodejs`，实际版本/路径由PM核对。
- 绘图应用5192、稳定MCP网关5193、独立Java控制面18080仅绑定回环；域名TLS由现有宝塔站点反代，不再另起一个抢80/443的nginx。
- `.github/workflows/cloud-candidate.yml`：main/手动/特定PR触发，Windows源码契约验证、Java/管理端构建，再Linux/Windows平台生产依赖和五型真实导出烟测；Linux包冻结后才允许部署。SSH secret只在部署job使用，PR不部署。
- 当前生产手动入口 `.github/workflows/cloud-promote.yml` 只认成功main run/attempt，且要求同run的 `staging` job成功。默认未启用 `CLOUD_AUTO_STAGING` 时，候选可以成功而生产晋级必然被该前置拒绝。
- `scripts/upload-cloud-candidate.mjs` 核下载档案SHA、固定SSH known_hosts，上传 `/var/lib/flymind/incoming/<releaseId>.tar.gz`；只执行受限 `sudo -n /usr/local/libexec/flymind-promote <environment> <releaseId> <SHA>`。
- `promote.mjs` 自身没有staging前置，支持首装无current：校验固定包→停旧app并确认MainPID0→备份dataRoot→原子换current→启动并核readyz/releaseId。失败仅同migrationLevel回退代码，不覆盖已确认数据。Java/gateway不由dispatcher晋级。

## 首次：不制造staging成功记录

1. PM先核实际Node完整版本、CPU/ABI、glibc、Python安全解压API、Java版本/路径、磁盘和既有服务/卷；不更改现MySQL/Redis业务配置，不上传任何本地图。
2. 使用干净冻结commit构建源码候选；**Windows现有开发包不能部署Linux**。优先Linux CI固定Node22.23.3/目标架构安装生产依赖、固定draw.io/font/Chromium后完成平台烟测。首次远端workflow还未推送时，可在受控Linux构建环境完成相同准备，不能把Windows node_modules改名当Linux。
3. 在目标机以flymind身份对候选副本做最小真实SQLite/固定browser sandbox/PNG验证；保留CI原始不可变包与摘要，不在 `prepared:true` 原包内重装或改文件。若OpenCloudOS确需不同依赖/供应，生成新的未prepared候选并重新smoke、清单、SHA；不能改完继续沿用原SHA。
4. 先独立bootstrap Java控制面、MySQL专用库/最小账户、Redis连接和密钥；再创建flymind数据根、root私有state/backup、独立上传账号incoming、审核后的root调度器/service/env。Node service与dispatcher wrapper均改为已验证的**同一个精确版本绝对路径**，不能依赖SSH PATH。
5. 首次可由PM调用已审核的production dispatcher，标记为“首次受控测试上线”，保存candidate SHA/commit/readyz/receipt。没有伪造staging记录，也没有永久关闭包校验。此操作不要求已经存在旧生产版本；数据根仍须预先flymind-owned，即使为空也离线备份。
6. app ready后独立启动网关，再接宝塔已有站点TLS/反代；只更改该站点配置，不覆盖宝塔全局nginx。核账号/团队、真实双浏览器+AI、MCP OAuth和PNG、断线草稿及更新恢复后，才称公网验收通过。

## OpenCloudOS不能直接照搬Ubuntu步骤

- 固定Playwright1.62.1本地源码 `node_modules/playwright-core/lib/coreBundle.js` 的hostPlatform逻辑：未识别Linux发行版回退ubuntu24.04包，并标为非官方支持。OpenCloudOS实际Chromium动态库、glibc、sandbox/user namespaces必须实测；`install-deps`的Ubuntu apt流程不能当作该机器已兼容。不使用no-sandbox兜底。
- `verify-cloud-candidate.mjs` 当前要求完整Node版本和ABI精确一致。宝塔已有Node若不是22.23.3，不能仅因同为22就跳过；PM应选择单独固定Node或统一正式候选版本（不是本审查擅改依赖）。
- `promote.mjs` 当前强制Python3.12+并使用 `tarfile.extractall(filter='data')`。目标Python版本未知，必须先核；若系统是有安全data_filter回移植的旧Python，可另审批改为能力检测，但不能删除filter、用裸tar替换或降低越界/预算检查。本批未改该实现。
- 服务器内存紧张：源码/Java/管理端构建放CI，不在服务器并行pnpm/Maven/浏览器矩阵；不新起另一套完整staging常驻占同一端口/内存。先测现有Java/MySQL/Redis RSS，再限定新增控制面heap、Node及单全局renderer预算。swap不等于8GB可用RAM，不承诺CI导出耗时可在此机器复现。
- `candidate`逐文件校验当前readFile会暂存大二进制；若目标内存峰值明显受影响，可单独改成流式hash，不影响SHA语义。本批未改源码。

## 后续main自动更新：需PM协调的最小workflow变更

建议保留现有双环境策略，同时显式增加**单环境生产自动更新模式**：

- 拟改 `.github/workflows/cloud-candidate.yml`：增加 `production` job，`needs: platform`，仅 `push main` 且仓库变量 `CLOUD_AUTO_PRODUCTION=true`；使用 `production` Environment secrets与原uploader，晋级同run Linux包。自动生产与自动staging不能指向同一current/dataRoot/service而同时开启。
- 首次手动production bootstrap不依赖该job。未来每次主分支验证成功后可自动更新，不必人工SSH。Environment人工审批可选，不设为产品每次强制点批准的要求。
- `.github/workflows/cloud-promote.yml` 现有人工同包晋级可以保留双环境用途。若以后用于单环境回滚/重晋级，须明确区分已有production成功凭据与staging要求；不能删掉所有provenance检查，只保留“任意run_id可下载”。
- stable gateway/Java保留独立安装位置与单独升级窗口；上述auto-production仍只更新app+admin。若同次更改了Java/OAuth协议，需先验证向后兼容并独立晋级控制面，不能宣称这两个job覆盖全栈升级。

PM已采纳单环境方案：本代理已在候选workflow增加受 `CLOUD_AUTO_PRODUCTION=true` 控制的production job，保持同run Linux artifact、production Environment及cloud-production并发锁；原双环境staging/promote保留。两开关同时true会在SSH前拒绝，不伪造staging。真正开启前先把已审工作流及对应脚本纳入获授权的远端分支；远端目前只有旧Verify时，不存在已启用的候选自动部署。

## Secret与不可变边界

`production` Environment：`SSH_HOST`、`SSH_USER`、`SSH_PORT`、`SSH_PRIVATE_KEY`、`SSH_KNOWN_HOSTS`。使用独立部署账号，不把本次root交互登录密钥直接授予CI。Host公钥从PM现有可信会话核对后固定，不在CI即时接受未知hostkey。应用/Java gateway key、MySQL、Redis、OAuth/JWT密钥只进服务器私有env，不进GitHub artifact/上传URL/命令参数。

保留：root审核调度器与配置、私有副本SHA后解压、固定供给校验、不同端口仍同根单活、停止后备份、当前导出结算、SSE reconnect而非撤权、HTTP ACK排出、旧代码回退且不自动还原DB。首次无旧代码失败就停新服务等待修复，不谎称可自动回滚到1.0本机Runtime。

## 本次交付与待决策

本次在PM追加授权后修改workflow、Node uploader、部署README及定向配置测试；没有远程操作、修改业务服务代码、提交或推送，也没有新跑绘图探针。uploader按forced-command限制使用stdin上传，不使用scp。root-ownedPython接收/dispatch由PM独占维护，不能用仅restrict的普通shell key替代。

PM需确定：使用CI22.23.3还是先协调已安装Node；目标Python/Chromium安全依赖是否可用；首次候选commit/构建来源；单环境auto-production模式是否采纳；Java/gateway独立bootstrap路径及宝塔TLS接入。证据为当前上述脚本/模板与PM已有服务器只读盘点，实际部署验收仍由PM执行。
