# Actions 控制面发布验收

2026-10-23。用户已授权本批修复提交/推送/合入main及通过Actions完成发布；禁止本机SSH，不改版本号、不打tag。当前阶段：本地限定通过，远端CI及服务器一次性安装待验收。

## 实现与审查

- 固定双代理复用：application负责独立Java发布器/备份/策略，engine负责workflow/uploader/forced command/真实基础设施烟测；PM负责Java就绪探针、集成审查、退回、复验及发布。
- 生产显式完整栈模式，Java成功后才晋级application/admin；Java失败不继续。手动部署默认false、限main、同run source+真实控制面+全部platform成功；自动开关未启。
- 受限发布命令只接受环境、run-id-attempt、SHA。root私有固定配置/目录/脚本；候选不提供可执行ops。固定备份helper自动产生并验证真实MySQL备份，允许迁移清单按真实JAR原字节哈希匹配；新SQL需独立策略审核，普通代码更新不用每次修改策略。
- Java探针校验回环来源/现有gateway key，ApplicationReadyEvent、实际凭据/关系表、Redis PING与运行JAR摘要。缺探针旧JAR不被称为健康；备份等失败且JAR尚未替换时，仅恢复之前运行状态并标注健康未复验。已切换新JAR失败默认停服/恢复标记，绝不还原旧数据库覆盖数据。
- 新增Linux隔离MySQL8/Redis7烟测：实际打包JAR启动→ready摘要→后台原始JWT登录/info/router→开通独立前台6位密码→改密/旧会话拒绝/新密码登录→后台登录态保留。通过后上传小型控制面运行证据，只有source/JAR/SQL摘要，不含凭据。

## PM 独立证据

- `output/auth-docs-20261023/pm-release-tests.log`：26/26，无跳过，含旧服务恢复退回修正；Windows路径链接用独立临时目录，沙箱EPERM后同用例在授权本地执行通过。
- `output/auth-docs-20261023/pm-java-release.log`：11/11，无跳过，实际Spring/Tomcat、H2、mock Redis，最终可执行JAR重建；不是正式MySQL证据。
- Python forced-command三项通过，不调用SSH/sudo；新命令严格白名单，旧非完整栈默认不扩权。
- 原本批账号/文档27项、类型及应用/管理端构建证据见[功能验收](auth-documentation-20261023.md)，不重复累计此前重叠测试。

## 真实发布剩余条件

1. 获授权提交推送后，远端真实JAR/MySQL/Redis、Windows/Linux固定供应及PNG烟测必须通过。
2. 用户通过服务器控制台一次性安装[受限入口](../cloud/CONTROL_PLANE_ACTIONS.md)、私有备份配置/就绪密钥/精确迁移策略。旧账户当前没有安装该入口的权限；不从本机SSH绕过。
3. 确认入口实际可用后才设置完整栈发布开关、选择可用传输并手动Actions发布；真实Java、网页、后台/前台及绘图验收后才开启持续自动发布。

当前不把代码、模板、测试或CI包描述为线上已更新。原用户密码、团队图形归属保持原样。

## 首轮远端验证与必要修正

已授权推送/合入`fb9856b`，两份Verify通过；候选run `39900100196`在source阶段被`local-auth-runtime.test.ts`首次未登录请求挡住（预期401、实际503），后续真实控制面/平台/生产均跳过。原日志未输出错误code；首次请求尚无credential、不会联系Java，11.44秒时长与Windows ACL冷启动10秒预算相合，属于有代码路径和时长支持的推断，不冒充完整根因实证。

修正仅将ACL冷启动改为有界30秒并按close结算，超时仍503，失败初始化仅允许后续独立请求重新完成权限校验；不改变撤权401、不自动重放写。断言补安全错误code和authority503→恢复→撤权401区分。PM隔离复验11/11（`pm-local-auth-ci-fix.log`），未放宽原401门槛。

用户已在服务器控制台确认：Node22.23.3为`/opt/flymind/runtime/node-v22.23.3-linux-x64/bin/node`，Python3.11.6为`/usr/bin/python3`且有data_filter；mysqldump为`/usr/bin/mysqldump`，forced-command为`/usr/local/libexec/flymind-ssh-command.py`。本机未SSH。

为减少控制台手工步骤，新增仅针对该已核主机的`install-control-plane-actions.py`：安全解析现有私有env，复用专用数据库凭据，不执行source/eval；干跑只读备份验证成功后才安装固定命令及精确sudoers。保留env/JAR/service/authorized_keys，不重启服务或改数据库，已有不同私有文件拒绝覆盖。PM纯测试9/9（`pm-installer-tests.log`），未实跑root安装。实际安装仍须用户控制台执行、输入同源已验CI政策及其摘要；模板/本地测试不代替目标机证明。

第二轮`0615dd8`候选run`39901502894`已通过原首次授权与超时/撤权分类测试，但被真实导出测试的原始TCP ECONNRESET挡住。原日志无法确认具体失败请求；测试使用全局空闲socket复用，而字体打包会占用同一事件循环跨越keep-alive期限，因此仅将短生命周期loopback夹具改为每请求独立连接，并增加响应aborted/error上下文；无写重试、无renderer业务修改。PM保持真实PNG、权限及单次关闭全部断言，独立10/10通过（`pm-http-lifecycle.log`）。连接复用是支持充分的推断，不称已完整实证。

为避免控制台初始化后再次编译已验应用，新增独立手动完整栈同包晋级：固定GitHub API校验run/attempt/SHA、source/真实控制面/两平台作业均success、候选为main祖先，之后才下载并晋级同run制品。PM已从既有成功run API核对平台精确显示名，纯门槛/命令顺序测试10/10通过（`pm-provenance-tests.log`）；不是放宽原staging工作流，也不绕过应用完整CI。实际远端晋级未执行。

第三轮`4b8aead`候选run`39902335946`全部源码契约、发布器/安装器纯测试、完整Java打包、双浏览器/MCP/更新恢复通过。本地账号浏览器探针未填写bcb已增加的必选任务分组，点击被禁用的流程图按钮超时，挡住后续候选；修正只让探针在原对话框先断言禁用、再填任务名称，创建后只读确认分组持久化，不取消产品约束。隔离探针登录/带组创建/退出撤权三项通过，证据`output/playwright/local-auth-ui/report.json`。浏览器探针顺序前移到build之后，使缺失UI操作先失败；所有原门槛保留，未减少覆盖。探针本身不宣称额外覆盖人工编辑/导出，它们仍由原双端和平台真实PNG门槛验证。

### 928c6d4 候选实际运行验证

2026-10-23，Actions run 39903410311：source及control_plane_runtime均成功。真实MySQL8/Redis7、打包JAR的就绪摘要、后台login/info/router、独立前台账号与改密撤权、后台会话保留通过；原始非敏感证据在output/auth-docs-20261023/39903410311-evidence。Windows/Linux五类PNG与SQLite平台作业尚在执行。

已按该证据及Git原始文件摘要生成一次性root控制台命令output/auth-docs-20261023/server-actions-setup-readable.txt，Python语法检查通过；尚未在服务器安装。待用户回传安装成功结果后才允许启用受限Java发布入口并从Actions晋级同一候选。线上未更新，CLOUD_AUTO_PRODUCTION仍关闭；本机无SSH操作。

2026-10-23后续状态：候选39903410311最终success，source、实际Java/MySQL/Redis、Windows/Linux五类PNG/SQLite四项均success，正式生产/预发按关闭开关跳过。用户要求由代理完成一次性配置，不再反复粘贴命令。现有Actions受限账号无新增root发布工具的安装权限，浏览器无已登录管理会话；本机root SSH只读权限检查被自动审批拒绝，未实际连接/执行，理由是此前禁止本机SSH仍生效。已向用户请求明确“仅本次SSH配置”例外；不绕过拒绝、不提前开启发布开关。

2026-10-23用户明确批准“允许仅本次SSH配置，后续部署全部走Actions”。本次SSH例外只用于安装受限Actions发布工具，不用于应用发布；后续部署仍走Actions。固定来源候选39903410311四项必需作业全部success，原应用版本/标签不变。一次性配置连接已进入腾讯云MFA，待用户微信身份确认，不要求用户运行脚本。

本次获准SSH配置：批模式核验因腾讯云强制MFA拒绝；交互连接7491移除认证前心跳超时后等待微信。腾讯云扫码服务随后超时并退到密码认证，未进入root命令、未执行安装；已取消连接，不索取聊天密码、不绕过MFA。待用户能立即完成登录确认时再生成当次有效二维码；发布包和Actions链已准备，应用部署仍仅Actions。

### 首次固定安装器实际执行与待定位

用户已明确批准“仅本次SSH配置，后续部署全部走Actions”。微信授权已实际通过。服务器访问raw.githubusercontent.com超时，尚未执行安装；改为标准输入直接传送同源、逐文件摘要校验的离线源码/CI政策，不再依赖服务器下载。禁止交互root Bash的自动审批拒绝后，改为单向固定`python3 -u -`安装器，不提供root shell。

为避免消息往返导致二维码过期，提供临时回环验证页：用户点开始时才发起SSH；无自动重试、至多3次点击、20分钟自动退出，仅固定安装或只读路径诊断；不保存MFA图像、URL或密钥。root登录成功，安装器返回`Installation path is not root protected`，未进入备份/工具安装、未修改应用和service。PM下一步通过同一验证页读取固定程序/祖先uid、mode及链接定位；保留root保护，不chown宝塔目录或放宽检查。原代理同步修复已知/bin usrmerge alias的窄路径兼容，mysqldump实际归属待只读证据。

应用候选39903410311保持全部通过，尚未部署；生产开关继续关闭。

### 固定路径诊断及最小修复边界

同一验证页只读SSH诊断成功：mysqldump实际指向`/www/server/mysql/bin/mysqldump`，目标和全部祖先uid0、无group/other写，不需改变宝塔目录。Node固定目录、bin目录及bin/node均uid1000/gid1000、0755；父runtime及其以上均root保护，是binary检查的首个实际阻断。`/bin`为root所有的usrmerge链接，canonical `/usr/bin/bash`及祖先均root保护。JAR、forced-command、私有env、source和政策路径权限正常；诊断未读取env内容。

PM已独立验收Bash窄修9/9（沙箱拒绝临时原子替换后，原测试在授权隔离临时目录完整通过），通用祖先检查不放宽。原engine代理实现只针对该固定Node的同字节所有权修复，不递归chown、不碰npm/lib/数据库或其他应用。

PM从官方HTTPS下载并核对Node22.23.3 Linux x64归档：archive SHA256 `df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de`；归档内bin/node SHA256 `fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48`，size124827920。只读本地证据`output/auth-docs-20261023/official-node-identity.json`。服务器尚未核对该binary摘要，因此不宣称已修复；修复器必须在摘要不符时零变更。

PM最终验收安装兼容修复：Bash固定canonical路径纯测试9/9；官方Node同字节所有权修复纯测试8/8，包含源摘要不符零变更、保留写入fd修改源的副本复核、bin条目竞态及独占临时文件清理。已将Node修复夹具加入同一候选source Windows及真实控制面Linux作业；两平台夹具不冒充真实root修复结果。下一步必要兼容修复提交到main并运行新候选；只有新run实际Java证据及平台验收成功后，组成同SHA离线一次性配置包，先修已确认Node归属、再安装受限工具，不混用旧政策/新源码。不改版本或tag。

### 精确文件权限修复（安装器维护版本）

b930048候选39926499342最终source/真实JavaMySQLRedis/Windows及Linux平台全部success。离线固定安装器实机已通过Node同字节所有权修复、私有配置及一致性数据库备份，但在最终sudoers-check退出并回退代码；无服务重启/应用发布。发现write_exclusive的os.open(mode)受root umask077影响，0440变0400、0755变0700，回退也受影响。现窄修创建fd后显式fchmod精确mode；不改私有配置或迁移政策。

PM Windows完整原9项通过，新POSIX权限项明确skip（非Linux证据）。新增独立Linux bootstrap workflow，实际临时文件验证umask077下0440/0755/0644/0600及0755回退，并保留8项固定Node修复夹具。应用继续使用已完整验收b930048候选；安装器维护源码及其文件SHA单独记录，不篡改candidate来源、不替换服务器已留存的同一policy。后续bootstrap同时写入root私有来源收据，区分应用候选和安装器工具源码；两者审核均通过后才执行。

安装器维护commit a1f8d60696580633d74d607d8c3c7702a6cfd1f3 的独立Linux workflow39929029301成功：真实POSIX installer10/10、Node修复8/8，原日志output/auth-docs-20261023/linux-bootstrap-mode-39929029301.log，无skip。应用仍晋级已全过run39926499342/source b930048，不等新应用重编译、不篡改该run来源。

一次性离线包应用源码/policy为b930048，只有临时安装器程序取a1f8d60；其余六个已审根工具源码逐字节保持b930048。两类源码和各文件SHA写入root私有bootstrap-provenance.json，Node修复安全收据也保存在该root目录；服务器既有policy原字节2f569a19...保持不变，不用新source覆盖。新包SHA7d06b27a...已本地解码逐Git blob及policy核对，临时回环页已准备，待用户MFA；应用尚未发布，自动开关仍false。

### 首次配置成功与Actions传输调整

固定安装器维护版a1f8d60通过同一本地验证页实际执行成功：installer installed=true，SSH exit0，原policy保持，Node官方同字节/精确权限及数据库备份验证通过，服务未重启。临时配置会话及回环服务已关闭，后续不再本机SSH。

已设置CLOUD_CONTROL_PLANE_DEPLOY=true，手动同包晋级run39929704421在真实服务更新前被artifact-https接收器拒绝（两次均`Artifact fetch refused; no archive published`），尚无上传或晋级。接收器精确存储host配置未被证明可用，不能把HTTPS传输称为已验收。改用既有受限flymind-upload字节流，保留同run源/平台/摘要/迁移/备份与Java先行门槛，不扩大服务器权限。CLOUD_ARTIFACT_HTTPS=false，自动生产仍false。CI上传器增加ssh -q抑制腾讯认证banner进入日志，远端固定命令stderr继续保留；PM原有13项来源/命令顺序测试全部通过。

同包字节晋级已由main fbbdbac触发run39930771837，目标仍是b930048候选run39926499342/attempt1，未混用新构建。09:35 UTC仍在上传/晋级步骤，实际/readyz还是旧release run-39450074276-1，因此此时不能宣称上线成功。上传阶段没有进度日志，正在补充有界传输进度及慢链路预算，现行作业不被本机干预。

独立Verify run39930757669的358项中357通过，一项Windows租约清理夹具失败：用例持有的owner为当前测试PID8936，PowerShell文件句柄200ms后只发送stdin关闭，未确认句柄已在750ms清理预算内释放。固定engine代理只读定位，未改运行时或延长其清理预算；此为有依据的夹具调度推断，尚非完全实证。当前Linux候选原四项验收全部成功，Windows夹具问题单独保留记录，不当作已修复。

run39930771837于09:41:13 UTC在20分钟上传边界失败（ssh code255），没有远端上传成功收据、未调用Java或应用晋级。原脚本没有传输计数，不能据此推断远端已接收比例。新增安全的单流发送进度，明确inputBytesQueued只是本地交给SSH的字节，不是远端落盘；字节上传硬限60分钟、发送停滞5分钟、EOF后回执10分钟，总限仍60分钟；每次晋级20分钟不变，整个production job120分钟。超时区分机器码，TERM/KILL有界收口，不自动重试不明请求，不改来源/SHA或服务器权限。

Windows失败夹具移除200ms调度假设：真实持锁至预算耗尽，明确验证PORT_OCCUPIED/cleanupCode及仅自有租约残留；收到Dispose和子进程退出确认后再次请求同一被占用端口，验证无清理错误、owner清空、无SQLite、原listener保留。生产运行时及750ms预算不变。固定两代理实施后，PM独立验收部署来源/命令/传输25/25及完整runtime-instance13/13，无skip。沙箱初跑因禁止临时链接/原子替换失败，在已授权的隔离夹具环境重跑通过；不将沙箱失败算作代码通过。候选仍使用原b930048/run39926499342，维护修复另行记录；未改版本/tag，未从本机SSH。
