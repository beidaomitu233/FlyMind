# Java 控制面部署包

唯一发布源码是仓库内 `integrations/xinghui-admin/`。上级 `D:/AIBuilder/PM/xinghui-admin/` 是历史受控副本；不再从它构建发布、不向用户源仓库反向同步。

## 构建

Java17、Maven3.9。在 backend 运行：

```powershell
mvn -s build-settings.xml -DskipTests package
pwsh -File deploy/build-control-plane.ps1 -Maven mvn -OutputDirectory <全新输出目录>
```

输出包括 `system-admin.jar`、启动器、无秘密环境模板、Linux systemd模板及字节SHA256清单；**不包含数据库、私钥、账户种子或运维环境文件**。`-DskipTests`只用于打包，不能替代下面的验证命令。H2依赖是test scope，不进入生产包。

## MySQL/Redis与首次初始化

1. 准备全新隔离MySQL库、专用账户及Redis逻辑库；实际地址/凭据只放私有服务环境文件。环境字段见 `control-plane.env.example`，不可使用示例公网域名直接部署。
2. 必须分别生成 JWT_SECRET 与 FLYMIND_GATEWAY_KEY（至少32 UTF-8字节）。网关密钥只在Node与Java后台共享，不发浏览器。Java默认只绑定127.0.0.1:18080；服务间跨主机时由操作者明确私网绑定、防火墙和TLS。
3. Flyway自动执行正式MySQL迁移，`baseline-on-migrate=false`；不接管非空未管理库，不访问原星辉数据库。
4. 首次空库显式设置 FLYMIND_BOOTSTRAP_ENABLED=true、手机号和12字符以上/72UTF8字节以下密码，启动成功后移除bootstrap变量并重启。已有账户会拒绝再次bootstrap。没有自动注册或默认账号。
5. 正常启动：进程环境已配置后，`pwsh -File start-control-plane.ps1 -JarPath ./system-admin.jar`；Linux可用模板systemd单位，私有EnvironmentFile由运维创建并限制权限（不提交Git）。未执行或验证真实Linux/systemd部署。

## 网关与Vben

- Vben固定构建 base=`/admin/`、API=`/api`；由同源网关将 `/api/` 前缀去掉后转发Java，例如 `/api/admin/flymind/users` → Java `/admin/flymind/users`。不能把 `/api` 原样传给没有该context-path的Java。
- `/admin/` 仅发布Vben静态产物。前端构建在frontend执行锁定pnpm安装后运行 `node scripts/build-flymind-admin.mjs`；该脚本拒绝覆盖操作者已有production.local。不要将Node/FlyMind页面错误路由到Java。
- FlyMind Node配置 `FLYMIND_CLOUD_CONTROL_PLANE_URL=http://127.0.0.1:18080`、同一个受控tenant对应的账号事实、相同gateway key与public origin。应用登录走 `/app/flymind/auth/login` opaque会话；管理UI走 `/user/login` JWT，不能拿app token冒充平台权限。
- 管理用户/团队页面已接Java真实API，具体路径见frontend的 `src/api/system/flymind.ts`。生产MySQL迁移、Redis限速/撤权及浏览器登录必须单独环境验收，本包不宣称已通过。

## 隔离验证

在backend运行 `mvn -s build-settings.xml -Dtest=FlymindIdentityTest,FlymindSecurityTest,FlymindBootstrapTest,FlymindOAuthTest,FlymindOAuthGateTest,FlymindHttpRuntimeTest -Dsurefire.failIfNoSpecifiedTests=false test`。

HTTP测试使用完整Spring应用+随机loopback Tomcat端口；数据库是H2 MySQL模式，Redis/Redisson和登录限速适配器为明确mock。它不会连接Redis/MySQL，不替代正式Flyway全基线迁移、Redis Lua限速或真实管理JWT登录。测试JWT_SECRET须通过一次性测试进程环境提供，不能将测试值用于部署。
