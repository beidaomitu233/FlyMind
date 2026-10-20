# V11-02-L 本地授权 gate（待 PM 集成验收）

2026-10-20。模块及随后 Runtime/CLI/登录薄页接线已落盘，待 PM 综合验收。未改变 1.0 用户工作区或 5189 服务。

## 固定接口

`server/local-auth/index.ts` 导出：

- `new LocalAuthorizationGate({controlPlaneOrigin, credentialDirectory, dataRootId, providerName?})`。固定 HTTPS origin；仅显式 `allowInsecureLoopback` 允许开发回环 HTTP。配置缺失报 `LOCAL_AUTH_CONFIGURATION_REQUIRED`。
- `authorize(permission: CloudPermission)`：每次在线查询 Java 权威，不缓存授权、不提供离线宽限；复用云端角色权限枚举。
- `login({phone,password,teamId?})`：先登录并查询 me 的真实团队。未选择时只返回短期 selectionId/团队列表，应用 session token 仅留内存。
- `clientDeviceGrant({selectionId,teamId})`：换取绑定设备、工作区、账号、团队的独立本地 grant；仅此 grant 写私有文件。
- `logout()`：先锁住当前实例并清本地 credential，再尝试远端撤销。文件失败也尝试远端撤销并抛错；绑定不被自动抹除或改人。
- `status()`：未授权仅返回 provider 显示名、固定 dataRootId、loginRequired，不返回路径/业务内容/令牌。
- `localAuthBrowserRouter(gate,{runtimeOrigin})`：GET `/status`，POST `/login`、`/device-grant`、`/logout`；交给 PM 在既有 Runtime 同源边界内挂载。精确 Host/Origin、写请求同源 JSON、2KiB 请求限额；成功响应不含令牌。

私有目录首次绑定 provider/root；首次成功登录再绑定 user/team。重新登录、退出、换进程均不自动改变这些绑定。改变绑定需要另行设计显式维护入口，不直接删文件重绑。generation/CAS 与实例 epoch 拒绝迟到授权和退出前的团队选择。

## Java 权威

正式发布源为 `integrations/xinghui-admin/backend`；上级副本和原始来源均未修改。

- `/app/flymind/local/grants`：Bearer 为现有应用 session，body 为 deviceId/dataRootId/teamId。与账号/团队行锁、唯一 binding_key 配合，绑定轮换不另建密码。
- `/local/introspect`、`/local/revoke`：只接受 `fm_local_` 目的令牌和精确设备/root。令牌 SHA-256 入库；本地 grant 不能冒充应用或 MCP token。
- 新 Flyway `V20261020_01__flymind_local_device.sql`。grant 依附父 app session，到期/账号停用/密码重置/父 session 退出均失效。成员移除、主动离队、平台停用团队同时永久撤 grant，重新加入/启用不会复活旧票。
- 独立 Spring chain 不依赖旧 Admin 单 JWT。设备接口由服务逐次验证；错误拒绝不返回旧授权。只读身份校验的 noRollbackFor 防止预期 401 被嵌套 rollback-only 异常掩盖。

本地文件是当前 OS 用户 ACL 保护的 bearer credential，不是硬件证明；同用户恶意进程或 OS 管理员不在此信任边界内。Windows 使用隐藏 PowerShell 的固定 .NET ACL 调用验证 owner-only；不能建立安全权限则拒绝，不降级。未知锁不自动抢占。

## 实际验证

| 命令 | 结果 | 证据 |
| --- | --- | --- |
| Node20 `--import tsx --test tests/local-auth.test.ts` | 8/8 | `output/local-auth-node-final.log` |
| Node20 `node_modules/typescript/bin/tsc -p tsconfig.server.json --noEmit` | exit 0 | `output/local-auth-tsc.log` |
| Maven `-Dtest=Flymind*Test -Dsurefire.failIfNoSpecifiedTests=false test` | 37/37，BUILD SUCCESS | `output/local-auth-java-final.log` |

Node 包括注入 provider、真实 Windows ACL 私有目录、真实临时 Express HTTP、跨实例 generation/迟到响应、断网/写盘失败/同源拒绝；其控制面响应为替身。Java 包括真实完整 Spring/Tomcat 随机回环端口的 4 个 HTTP 场景：原账号团队、OAuth、设备绑定/退出/停用，以及轮换/过期/密码重置/成员与团队撤权；数据库为 H2 MySQL 模式，Redis/Redisson/login limiter 明确替身。首次回归新增外键使旧“删 session 表模拟故障”被外键先拒，已将该测试改成 CASCADE，仍断言服务 503。

## 实际 Runtime/CLI 接线（后续切片）

`server/runtime.ts` 在 store.init/本机租约前校验 `FLYMIND_CONTROL_PLANE_ORIGIN`；无配置报 `LOCAL_AUTH_CONFIGURATION_REQUIRED`。HTTPS 固定 origin；显式回环 HTTP origin 仅用于独立开发控制面，仍逐请求鉴权。credential 目录由 `FLYMIND_PRIVATE_RUNTIME_DIR`（缺省当前用户 FlyMind/runtime）及实际 dataRootId 派生为 `local-auth/<dataRootId>`。恢复换 root 会拒绝原绑定，不自动换票。

health 及原 session bootstrap 仅提供最小启动/传输身份；私有 Bearer shutdown 保留原独占维护校验。`/studio-api/local-auth` 接精确 Host/Origin 登录路由；其余业务 API（包括原 legacy HTTP）和制品逐次 gate，原 private Bearer/HttpOnly cookie 要求仍在。viewer 可读取和导出，写组织/图形被拒绝。公开静态应用/固定 draw.io 供应不含用户业务内容。

`/` 与 `/native` 现为 LocalAuthorization 薄包装；登录后仍渲染原 NativeStudio，viewer 只读；草稿 db 名分 user/team/dataRoot。401/403 或定期身份检查失败会隐藏旧内容并调用原 `suspendForIdentityChange` 保存到旧仓库，不 flush。CLI `login`/`logout` 打开同源浏览器，不接收密码参数；`studio` 同样进入登录薄页。CLI setup/doctor 仍可在未登录时准备资源。

`server/mcp.ts` 默认仅 native facade，删 PILOT 环境flag不能回到旧直接 SQLite MCP。旧版源码只可明确从 `mcp-legacy.ts` 开发入口调用。Runtime 能力新增 `localAuthorization:true`，精确握手拒绝当前旧1.0未授权实例，不重启/升级用户旧实例。MCP账号401保留 `LOCAL_LOGIN_REQUIRED`，提示执行 `flymind login`、在浏览器授权，不向AI传密码，也不误清私有传输连接。

### 接线验证结果

- `local-auth.test.ts`、`local-auth-runtime.test.ts`、`native-mcp.test.ts`、`runtime-instance.test.ts`：36/36，`output/local-auth-final-tests.log`。真实自有临时 Runtime + authority 替身：登录前 cookie/MCP Bearer 都不能读，授权后可读，撤权后读写401，正常IPC退出/临时目录清理；握手拒旧能力。授权本体8项包含Windows真实ACL。
- `drawio-native-storage.test.ts`：11/11；与旧 runtime 文件合跑初轮13/14，唯一旧标准文字断言在后续 legacy 全通过复验闭合。`output/local-auth-compat-fix.log`。HTTP旧fixture已显式启动临时 authority 并登录，没有生产逃生flag；旧view/no-op fixture不再把真实pageWidth改变当纯视口噪音。
- `runtime.test.ts`：显式预编译 legacy 开发入口3/3，`output/local-auth-legacy-final.log`，当前标准1.1断言同步；不恢复默认 legacy 分支。
- `package-cli.test.mjs`：4/4，`output/local-auth-cli-tests.log`。server tsc、vue-tsc exit0，日志 `output/local-auth-{runtime,ui}-tsc.log`；仅编译lib，没有启动用户服务。
- **真实 Node gate→完整 Java Spring/Tomcat HTTP**：`FlymindHttpRuntimeTest#realNodeLocalGateUsesJavaAuthority` 1/1（skip0），`output/local-auth-node-java.log`。使用 `-Dflymind.nodeExecutable=C:/nvm4w/nodejs/node.exe`，未设property的普通Java测试明确skip该跨语言项。stdin传临时fixture凭据，脚本实际执行login/me/grant/authorize/root拒绝/logout/relogin，SQL核对2个父session已撤销。私有目录清理。仅输出字段类型诊断，不打印密码/token；真实Jackson的Long字符串时间由严格安全十进制codec归一化数字。
- 收尾 Runtime 登录 parser 顺序复验：2/2，`output/local-auth-runtime-final.log`，实际全局4MB业务parser之前先执行本地登录2KiB限制，超限413。
- 最新 Java 可部署 jar 已重新打包：`mvn ... '-Dtest=Flymind*Test' '-Dflymind.nodeExecutable=C:/nvm4w/nodejs/node.exe' '-Dsurefire.failIfNoSpecifiedTests=false' package` **39/39、skip0、BUILD SUCCESS**，`output/local-auth-control-plane-package.log`。其中6个真实HTTP场景包含上述本地Node组合，以及engine提供的真实CloudControlPlane/OAuth组合；不是SDK绘图PNG或真实Redis。
- 新独立部署包 `integrations/xinghui-admin/backend/deploy/out/control-plane-local-auth/`（ignored）含最新jar/启动脚本/无秘密env模板/systemd/manifest；未覆盖早期产物。jar 128,151,083字节，SHA256 `c6bc7a00e70d2c3f1f816d29d0c216de2a96bc031b1d1a05ce137cf0e1a9a062`。

仍未验证：真实浏览器登录/退出/失效页面、完整 Runtime→真实Java→UI/MCP 三层单进程组合、正式MySQL/Redis、Linux ACL/公共HTTPS部署。Java组合仍为H2 MySQL模式+明确Redis替身。测试均正常退出，无自有常驻进程；未连接用户库。Web dist及早期部署目录仍是旧构建；PM实页验收须统一重建Web/lib，使用本片新jar而非旧目录。
