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
