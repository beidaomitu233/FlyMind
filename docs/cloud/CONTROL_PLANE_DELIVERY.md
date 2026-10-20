# 控制面可部署切片验证（V11-02/06）

日期：2026-10-20。状态：开发交验，待PM独立验收。本切片只修改受控 `integrations/xinghui-admin/**` 与本文；没有部署公网、访问源库/用户库、修Docker或改变本地1.0授权行为。

## 1 单一发布源

后续唯一构建与发布源为 `integrations/xinghui-admin/{backend,frontend}`。上级 `D:/AIBuilder/PM/xinghui-admin/` 是先前受控副本，只读对照，不继续双写；原 `D:/changhuiengineer/DevProject/xinghui-admin2` 未访问/未修改。只读核对时仓库HEAD为 `125101f`，本切片为其上的未提交改动。

对照排除了.git、node_modules、target、dist、输出、日志、.npmrc、秘密.env；只读SHA256不打印正文。后端历史264个被核对源码/配置文件，前端985个；前端规范CRLF/BOM后0差异。后端原字节差异多为换行，本切片前无额外业务源码缺失；本切片新增HTTP/启动配置测试和deploy目录，实质主源码差异为deployment guard及application配置。证据 `output/control-plane-source-audit.json`。

没有从历史副本复制node_modules、构建输出、数据库或凭据。前端本目录目前无node_modules/dist，后续必须从本发布源执行锁文件安装和构建，不能从上级产物混发。

## 2 已交产物

- `backend/deploy/control-plane.env.example`：无秘密MySQL/Redis/tenant/JWT/gateway/public origin模板。
- `backend/deploy/start-control-plane.ps1`：验证明确环境配置后启动Java17 fat jar，不写入凭据、不创建账户、不连接源配置。
- `backend/deploy/build-control-plane.ps1`：只对不存在的输出目录构建/复制fat jar及部署说明、写逐文件SHA256清单；已有目录拒绝覆盖。
- `backend/deploy/flymind-control-plane.service`：Linux systemd部署模板，尚未在Linux实际运行。
- application：默认loopback，优雅停止；Redis连接/请求超时；Flyway禁止clean和自动baseline；关闭Druid公开监控servlet/filter。
- `FlymindDeploymentGuard`：除了既有JWT_SECRET≥32字节，新增gateway key≥32字节与精确HTTPS origin启动校验；loopback HTTP仅供隔离验证，无默认credential。

实际输出目录：`integrations/xinghui-admin/backend/deploy/out/control-plane/`（已忽略，非源码/发布提交）；含jar、启动器、模板、systemd单位、README、manifest。

Jar：128,142,365字节；SHA256 `afd2583d9ec7958fd061557dc55f908deb1870c7624073079c4cd1ee4b5d7fc5`。未修改Maven/application版本。H2和测试fixture不进入生产jar。

## 3 实际命令与证据

环境：Windows，Java17.0.19，Maven3.9.11。Maven实际路径：
`C:/Users/12062/.m2/wrapper/dists/apache-maven-3.9.11-bin/6mqf5t809d9geo83kj4ttckcbc/apache-maven-3.9.11/bin/mvn.cmd`。

在仓库根：

```powershell
mvn -f integrations/xinghui-admin/backend/pom.xml -s integrations/xinghui-admin/backend/build-settings.xml '-Dtest=FlymindIdentityTest,FlymindSecurityTest,FlymindBootstrapTest,FlymindOAuthTest,FlymindOAuthGateTest,FlymindHttpRuntimeTest,FlymindDeploymentGuardTest' '-Dsurefire.failIfNoSpecifiedTests=false' package
```

测试进程单独生成随机JWT_SECRET，经环境提供，运行后恢复/清除；没有把密钥写进源码、命令参数或日志。首次沙箱依赖下载被getsockopt拒绝，正常权限同入口运行后成功。完整真实HTTP首次缺mock ReactiveRedisConnectionFactory，已修为明确替身；未改生产Redis装配来绕过。

最终 **35/35**、失败0、错误0、跳过0，BUILD SUCCESS；证据 `output/control-plane-package-final.log`。其中新增完整应用HTTP2项、部署guard1项；其余32项为原身份/权限/邀请并发/OAuth/撤权回归。

```powershell
pwsh -File integrations/xinghui-admin/backend/deploy/build-control-plane.ps1 -Maven <Maven路径> -OutputDirectory <不存在的输出目录>
```

实际打包成功，证据 `output/control-plane-bundle.log` 与输出 `manifest.json`。只生成组件部署包，未在无MySQL/Redis条件下谎称生产jar已完整启动。

### 真实HTTP覆盖

`FlymindHttpRuntimeTest` 显式启动 **整个 XinghuiStartApplication、完整Spring装配、Tomcat随机loopback端口与真实JDK HttpClient**；最终日志实际端口9258。不是standalone MockMvc：

- 未登录/未知路径保护；手机号密码应用登录。
- 创建团队→邀请既有账号→一次性接受→成员列表。
- 平台用户列表与停用真实HTTP；app token不能当Admin JWT；停用后原应用token立即拒绝。
- OAuth gateway必需、应用Bearer inspect/approve、S256授权码换票、code一次性。
- access introspect、refresh轮换、旧refresh重放撤grant，原access拒绝。

**明确替身/未验证**：H2 MySQL模式，仅执行身份/OAuth三份迁移；未跑正式MySQL基线/旧schema动态对齐。Redis/ReactiveRedis/Redisson与登录限速为mock；Admin JWT由测试fixture签名并供给mock缓存，真实LoginFilter执行，但不等于真实Redis/手机号Admin登录已过。JWT本身不是mock。请求/回包中的token仅在测试内存，不输出日志。

测试子进程已正常退出，未留下本代理服务、容器、浏览器或Runtime。

## 4 Vben与网关接线核对

保留Vben/Element Plus原管理页，无重画：

- 管理登录：`/user/login`，字段phone/password及已有captcha，返回原Admin JWT。
- 受控账号：`/admin/flymind/users` GET/POST，`/:id` PATCH停启用，`/:id/password` POST重置；权限仍Admin方法权限，非app token。
- 团队：`/admin/flymind/teams` GET，`/:id/members` GET，`/:id` PATCH停启用。
- 前端API来源：`frontend/apps/web-ele/src/api/{core/auth,system/flymind}.ts`；静态base `/admin/`，API `/api`。
- 同源网关必须将 `/api/` **去前缀**转发Java；例 `/api/admin/flymind/users`→`/admin/flymind/users`。`/admin/` 发布前端静态产物，不把Java控制器误当静态前端。
- Node实际配置字段为 `FLYMIND_CLOUD_CONTROL_PLANE_URL`；public origin与gateway key两端一致，Java仅受控私网/loopback可达。

PM已在 integrations 正式前端源使用锁定 pnpm10.28.1 安装并实际构建：214文件、3,462,977字节，tree SHA `c21eb593…f48a2`，`/admin/` base、`/api` API及无分析脚本检查通过，证据为 PM `build-result.json`。这不是上级产物，也不等于真实浏览器管理登录或正式MySQL/Redis已通过。反向代理后的IP限速还需受信代理策略验证，不能任意信任外部X-Forwarded-For。

## 5 本地授权后续实现

本报告上一交付片仅记录方案；此后 V11-02-L 已实现本地设备 grant、强制 Runtime 业务 gate、登录薄页和 CLI login/logout，详见 [LOCAL_AUTH_GATE.md](LOCAL_AUTH_GATE.md)。v1.1入口缺固定控制面配置即拒绝启动，不通过删环境flag回退无保护。当前用户1.0服务和数据仍未重启或迁移。

新链路复用 Java 应用登录/me，再换独立 `/app/flymind/local/*` 设备授权，私有目录仅保存本地 grant；固定 user/team/root，不把应用密码或长会话放入 MCP 配置。验收范围与仍未验证的正式数据库/部署边界在新报告中逐项列出；不将早期35项打包结果当作后来授权代码的打包证据。

后续已实际完成带 `-Dflymind.nodeExecutable=C:/nvm4w/nodejs/node.exe` 的完整 Java package：39/39、skip0，包含真实 Node gate 与 Cloud identity/OAuth 调 Java Tomcat。证据 `output/local-auth-control-plane-package.log`；新包位于 `deploy/out/control-plane-local-auth`，摘要见 LOCAL_AUTH_GATE，不覆盖第2节历史包。H2/Redis替身边界不变，尚不代表正式MySQL/Redis验证。

离线许可时长、撤权缓存和付费entitlement目前没有冻结契约/实现；不可把旧本地缓存当永久授权，也不能凭空新增授权码或收费表。该缺口需单独授权实施和真实离线/重启/撤权验收。

## 6 交验范围

请求PM审查：单一发布源、部署模板/guard/组件包、H2完整Spring真实HTTP切片及Vben API契约核对。**不宣称V11-02/06整体通过、生产MySQL/Redis或公网发布成功。** 后端来源许可证未明确的既有风险不因FlyMind MIT自动消失，公开分发仍需权利确认。
