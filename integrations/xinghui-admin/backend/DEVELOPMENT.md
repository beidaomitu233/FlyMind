# Java 控制面开发说明（C01 核心切片）

本目录只在受控副本开发。禁止连接原星辉或FlyMind用户数据库。当前已编译，身份/团队SQL与Spring Security链使用H2内存库验证；尚未证明真实MySQL/Redis整机启动或管理前端闭环。

## 环境

Java17。当前已找到Maven3.9.11：
`C:/Users/12062/.m2/wrapper/dists/apache-maven-3.9.11-bin/6mqf5t809d9geo83kj4ttckcbc/apache-maven-3.9.11/bin/mvn.cmd`。
`build-settings.xml`不含镜像账号或凭据，避免继承源私有配置。

必须由操作者为**新建隔离服务**设置：

- `ADMIN_DB_JDBC_URL`、`ADMIN_DB_USER`、`ADMIN_DB_PASSWORD`：新MySQL库。
- `ADMIN_REDIS_HOST`、`ADMIN_REDIS_PASSWORD`；可选 `ADMIN_REDIS_PORT`、`ADMIN_REDIS_DATABASE`：新Redis实例/数据库。
- `JWT_SECRET`：至少32字节、独立生成的管理端签名密钥；没有默认密钥，缺失时启动失败。
- `FLYMIND_APP_TENANT_ID`：1–20字符的服务端受控应用租户，不从用户请求体取得。
- 可选 `ADMIN_PORT`（默认18080）、`ADMIN_BIND_ADDRESS`（默认127.0.0.1）。

源码application.yml只有环境占位，无源地址/密码。Flyway只对空隔离库建表；baseline-on-migrate关闭，不自动接管存量库。

## 显式初始化

不会自动创建账号。第一次对空库准备平台账号时，额外设置 `FLYMIND_BOOTSTRAP_ENABLED=true`、`FLYMIND_BOOTSTRAP_PHONE`、`FLYMIND_BOOTSTRAP_PASSWORD` 后启动；密码至少12字符且不超过72 UTF-8字节。初始化事务创建受控租户、BCrypt用户和显式权限；有任意已有账号就拒绝，不覆盖。完成后移除这些bootstrap变量再正常运行，不能长期保留密码在脚本/仓库中。用户一期由管理员开通，无开放注册接口。

## 构建与定向验证

```powershell
mvn -s build-settings.xml '-Dtest=FlymindIdentityTest,FlymindSecurityTest,FlymindBootstrapTest' '-Dsurefire.failIfNoSpecifiedTests=false' test
mvn -s build-settings.xml -DskipTests package
```

H2测试只验证新表、JDBC事务/并发邀请与MockMvc+实际Spring Security配置，不冒充MySQL、Redis限速、真实网络或前端验收。旧管理JWT验证器在安全链测试中用隔离替身，管理权限链和应用opaque校验真实执行。

## 新接口与会话

完整契约：`../../flyMind/docs/cloud/CONTRACT.md`。
应用路径 `/app/flymind/**` 只接受 `Bearer <opaque token>`；登录只返回一次明文，数据库仅SHA256。每设备会话独立，退出仅撤销本会话。旧管理端JWT链仍独立；应用令牌不能授权 `/admin/flymind/teams`。

团队是独立业务对象。个人空间不可邀请；普通团队验证membership后读取/修改。邀请绑定既有账号、48小时、摘要存库、同事务一次性接受；原邀请者失去管理权限后不能继续授予权限。停用用户、停用团队、移除成员对后续introspect立即拒绝。当前无远程MCP OAuth、协同、支付或离线授权能力。

## 当前交验范围

C01第一切片已实现应用认证、团队/邀请/成员API、平台团队列表/停启用与应用账号开通/停用API。bootstrap显式生成M目录+C用户/团队菜单，F权限不再冒充可见路由。Vben保留原Page/Element Plus页面结构，用户页接新受控账号API，团队页接实际平台API；尚未安装前端依赖、类型检查或真实浏览器验收。

测试使用H2而非MySQL，Redis登录限速为隔离替身；实际MySQL迁移/Redis限速/full Spring启动与原JWT实际登录需要新的隔离服务验证。旧JWT verifier在新安全链测试中明确用替身，不声称原管理JWT链已完整集成。

C01-UI必要安全补充：停用账号/重置密码同时撤销全部app sessions并删除目标用户ADMIN_LOGIN_PREFIX Redis登录态，失败抛503并回滚SQL；不重写旧JWT。状态只接精确0/1。status-password-test.log中的3项定向通过（H2+mock Redis），最终build-final.log打包成功。真实Redis/MySQL依旧待验。
