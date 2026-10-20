# 星辉管理后台复用审计

日期：2026-10-19。此报告记录审计时事实；当时仅审计、尚未复制或实施。随后 PM 已验收审计与正式源码复制，副本开始 C01 开发，最新实现和未验收范围见 [任务台账](TRACKER.md) 与 [首批核验](validation/initial-foundation.md)。没有启动或修改源系统服务。

## 1. 结论与建议

保留并复用 **Java 后台管理系统及 Vben 管理端**，作为账号、系统用户/角色/菜单、运营管理的基础；FlyMind 原工作台继续作为绘图产品界面，不换成 Vben 工作台。PM已选定复制到 `D:/AIBuilder/PM/xinghui-admin/backend/` 与 `frontend/`，通过统一域名的 `/admin`、身份 API、FlyMind 业务 API 集成。不是仅取其 UI，也不是把 Java 源码塞入 Node 进程。

现有实现可以提供手机号密码认证、JWT/Redis 登录态、角色权限、租户与套餐 CRUD；**不能认定已具备** ToC 注册/账号找回、多团队成员与切换、本地产品授权、OAuth 授权服务器、远程 MCP 授权或多人实时协同。后述新增接口均为建议，不是现有 API。

最快可用顺序：先可复现复制与独立启动管理后台，再完成统一身份和工作区访问边界，然后团队管理/本地授权，最后协同与远程 MCP；不能仅把本机 localhost Runtime 反向代理到公网就算完成线上化。

## 2. 来源、正式主目录与版本证据

源根：`D:/changhuiengineer/DevProject/xinghui-admin2`。根目录不是 Git 仓库。

| 正式部分 | 源子路径 | 只读核对结果 |
|---|---|---|
| 管理前端 | `UI/`，应用为 `apps/web-ele` | 独立 Git HEAD `e313de8bd9c92924efdba64b99452917e72b24b0`，2026-09-26；package `xinghui-admin-ui`/`@vben/web-ele` 5.5.9 |
| Java 后端 | `springboot-admin-xinghui/xinghui-admin/` | 独立 Git HEAD `ff68475be7aeaa941fe62c78aa66272f075178fb`，2026-09-26；Maven `com.xinghuiTec:xinghui-admin:1.1.0-SNAPSHOT` |
| 非正式运行源 | `vben-admin-rutorial/` | 仅 Vben 使用教程，不作为前端源 |
| 排除区域 | `worktrees/`、`Reference/`、`page-prototypes/` 等 | 未审阅其正文，不据此选择另一套实现 |

两个正式 Git 工作区 `status --short --untracked-files=no` 未输出已跟踪改动；这不保证无未跟踪文件，后续复制必须使用审核后的文件清单。Git 只使用命令级 `-c safe.directory=<精确源路径>` 读取提交/status，没有修改全局 Git 配置，也没有读取 Git 凭据/remote 配置。

已读取当前 PM/FlyMind AGENTS、文档入口及实施计划；源父目录及正式源码路径未发现 AGENTS.md。未读取 `.env`、数据源配置值或实际数据库，未输出密钥。源码内默认配置/SQL 种子是否含真实秘密，需复制阶段做脱敏审查，不能整体照搬。

## 3. 技术与运行边界

- 前端：Vue 3.5.27 范围、Element Plus 2.13.1 范围、Pinia、Vue Router、Vben workspace 包；Vite 7.3.1 范围、pnpm 10.28.1，Node >=20.19。证据 `UI/package.json:94`、`UI/pnpm-workspace.yaml:95,179,189`、`UI/apps/web-ele/package.json`。以上为声明范围，不冒充已解析 lock 精确版本。
- 前端不能只复制 `apps/web-ele`：依赖 `packages/`、`internal/`、`scripts/` 和 pnpm workspace/catalog。保留必要工作区依赖闭包，先不大规模裁剪。
- 开发代理 `UI/apps/web-ele/vite.config.mts` 将 `/api` 去前缀后代理 `http://localhost:7799`；`ws:true` 只是代理配置，不能证明存在协同 WebSocket 服务。生产 baseURL 来自配置机制，本轮未读取环境文件。
- 后端：Java17、Spring Boot3.3.6、Spring Security、MyBatis-Plus3.5.10、MySQL8.0.33 驱动、Redisson3.40.2；Flyway 管理 MySQL 表结构；依赖还包括 Druid、JustAuth1.16.7、短信/邮件/OSS、Quartz 等模块。证据父 POM、system-admin/common 各 POM。不能直接复用 FlyMind SQLite 表作为该后台 MySQL 库。
- `system-admin` 是聚合启动模块；`system-framework` 提供安全/过滤器，`common` 提供核心、安全、租户、Redis、OSS 等；`web-admin`、`web-app` 已分管理端与应用端业务扩展位置。保留此模块结构，在应用端新增产品业务，不让 ToC 用户取得系统管理权限。
- 已有相关测试源码如 LoginServiceTest、LoginFilterTest、TenantHelperTest、JwtUtilTest、SysUserControllerTest；本轮未执行构建/测试，不能据文件存在宣称通过。

## 4. 实际身份与 API 契约

下表为源码方法路由（不含部署网关前缀）。统一响应为 `{code,message,data}`，前端以 `code=200` 解包；不能照搬为 FlyMind 现有错误响应格式。

| API | 已核输入/输出与行为 | 证据（相对后端源根） |
|---|---|---|
| `GET /captcha` | `data={uuid,img,enabled}`；禁用时返回空内容与 false | `system-admin/.../controller/LoginController.java` |
| `POST /user/login` | `{phone,password,code?,uuid?}`；`data` 是 JWT **字符串**，UI 转成 `{accessToken}` | 同上；`domain/dto/LoginDTO.java`；前端 `src/api/core/auth.ts` |
| `POST /user/logout` | 删除当前 userId Redis 登录态 | `service/impl/LoginServiceImpl.java:108` |
| `GET /user/info` | `data={user,roles,permissions}`；user 密码被 JsonIgnore | `common/common-core/.../domain/vo/UserInfoVO.java`、`SysUser.java` |
| `GET /user/router` | 角色允许的菜单树 | LoginController、LoginServiceImpl |
| `/system/user` | GET list；POST add/edit/remove/resetPwd；导入导出等，按 `system:user:*` 权限控制 | `controller/SysUserController.java:39` 起 |
| `/system/role` | GET list/{roleId}/menuIds；POST add/edit/remove/changeStatus/assignMenus | `controller/SysRoleController.java:27` 起 |
| `/system/tenant` | GET list/{id}；POST新增、PUT修改、DELETE /{ids}；按租户管理权限控制 | `controller/SysTenantController.java:19` 起 |
| `/system/tenantPackage` | 套餐 list/详情/增改删 | `controller/SysTenantPackageController.java:18` 起 |

安全链（`system-framework/.../config/SecurityConfig.java`、`filter/LoginFilter.java`）：BCrypt 密码验证、无状态 SecurityContext、JWT 验签/期限检查，之后必须命中 Redis 登录态且 token 完全一致。**Authorization 目前直接传 JWT 字符串，不是标准 Bearer 拼接**（前端 `api/request.ts`）。不要把它与 FlyMind Runtime Bearer/实例 cookie 认为是同一凭据。

Redis 登录态键按 userId，登录覆盖该用户旧 token，退出删除该 userId 状态；当前语义不适合不加改造地承诺多设备、本地客户端和远程 MCP 同时长久在线。前端刷新逻辑明确抛出“当前未启用令牌刷新”；401 后清状态重新登录。

`SecurityConfig` 允许 login/root/captcha/druid 匿名，CSRF/CORS 均关闭。公开部署前须单独审查 druid 暴露、同源/cookie 策略、敏感日志和权限检查，不能照搬本地配置当公网安全基线。JWT 签名使用共享常量来源，生产需单独审查注入/轮换方式，本报告不记录任何密钥值。

## 5. 租户不是已完成的团队功能

- `SysUser extends TenantEntity`，只有一个 `tenantId`；`SysTenant` 是企业租户，含套餐、期限、账号数量、状态。`licenseNumber` 是统一社会信用代码，**不是软件授权码**。
- `UserDetailManageImpl.loadUserByUsername` 忽略租户按手机号查询；零匹配拒绝，多匹配拒绝；成功后取用户实体 tenantId。不是登录时可选团队，也没有账号跨多个团队的成员关系。
- 当前正式业务源码未找到 team/member/invitation/switchTenant 控制器/实体，UI 的 system 页面也没有租户/团队管理页。`TenantHelper.setDynamic` 是线程内后台辅助函数，不能作为用户切团队授权接口。
- MyBatis tenant handler 依赖当前 tenantId；无租户时 `ignoreTable` 返回 true，属于必须检查的隔离风险。`TenantHelper.ignore` 是显式绕过点，需要用例覆盖。
- `SysTenantServiceImpl.checkTenant` 定义停用/过期校验，但正式 Java 源中搜索只找到接口声明与自身实现，未见登录链调用。不能宣称禁用/过期租户已在每次访问生效。
- `sys_user` 基线仅 username 唯一索引，没有 mobile 唯一索引；登录代码处理重复数据，但无法替代注册事务与并发唯一约束。复制时必须核对完整迁移链，不能仅凭基线判断线上实际索引。

PM已确认团队为独立业务对象：同一FlyMind账号可加入多个团队，公共应用账号统一置于受控tenant，服务端验证membership后选择team；不把sys_tenant直接等同团队。建议新增稳定account + team + team_member模型。身份不随团队切换，团队角色在 membership 中计算；个人工作区也需明确 owner。禁止信任客户端任意 tenantId/header 直接选 SQL 过滤范围。

## 6. 已发现的前后端缺口

1. `UI/.../api/system/user.ts` 的详情调用 `/system/user/getuser?userId=`，正式 SysUserController 未见该路由；`/system/user/info` 实际是本人聚合详情，不是等价替换。字段接口还使用 userName/nickName/phonenumber，而后端实体是 username/nickname/mobile。需在复用阶段逐接口契约测试，不能直接认定管理页全可用。
2. 注册页 `views/_core/authentication/register.vue` 的 handleSubmit 仅 console.log 表单，无注册请求，且可能打印密码。忘记密码/验证码登录页面的存在也不算后端闭环。上线前移除敏感输出并实现真实注册/找回。
3. `common-social` 有 JustAuth helper/config/state cache，但在正式 controller 扫描中未见对应已闭合的社交登录/回调路由；更不等于面向 MCP 客户端的授权服务器。
4. 当前角色/菜单权限适合后台操作授权，不等于图形所有权、查看/编辑/分享、导出任务和制品的资源级权限。每个业务入口都要补相同团队/文档校验。
5. 未见可直接复用的实时协同协议、presence、操作合并或共享 Undo。FlyMind 现有 revision CAS 只能防覆盖，不是多人同时编辑；协同方案须与 draw.io 宿主和持久化策略独立冻结。

## 7. 最快复制与集成计划（尚未执行）

### C0 受控复制与可复现基线

PM 冻结目的路径后，按两个正式 HEAD 导出/文件清单复制 Java 全模块、前端 workspace依赖闭包。保留 Java 后台和管理页；不复制生产配置/数据。配置必须重建为无秘密模板，SQL schema 与种子分开审查，禁止把源账号/密码/演示业务数据初始化到公开环境。保留 FlyMind 原UI与 npm 本机模式。

先验收独立 MySQL/Redis 环境下 Java构建、登录/登出/禁用账号/租户隔离及Vben用户角色页；无需先把绘图应用改壳。拿到两份受控源摘要，记录后续本地修改。

### C1 统一身份、资源授权与本地授权

Java负责账号与成员管理，FlyMind Node继续负责图形/原生渲染。建议通过内部鉴权接口/受限可验证凭据接合，不复制Java JWT密钥到浏览器或所有worker。统一域名把管理页、原绘图UI、API分路由，受保护Node不能继续仅认localhost或实例token为终端用户权限。

需冻结的新增契约：账号subject、teamId/workspaceId、角色/scopes、sessionId、期限/撤销、错误码；云与本地使用同账号主体，但本地“必须授权”还需设备授权/凭据存储/离线失效边界与明确UI，不由原tenant套餐字段冒充。服务端禁止伪造身份头，审计记录actor与team；图形/history/导出/文件/草稿/幂等key加入明确身份作用域。现有本地数据迁入云端应显式导入，不默迁移当前用户库。

### C2 团队与访问控制

新建/邀请/接受/退出/移除、owner转移、多团队切换、viewer/editor/admin权限与撤销生效；团队外的diagramId/exportId访问均须拒绝。管理员后台和ToC团队管理路由可不同，但共享身份/成员服务。先验证两个账号两个团队越权用例再开放公开注册。

### C3 真协同与单URL MCP

由PM/A另冻结协同算法及远程MCP传输/授权协议；本报告不指定未经核实的第三方实现。MCP必须用可授权的HTTPS单URL入口接同一应用服务，注册客户端/授权/令牌scope与撤销需真实闭环；不能把管理JWT原样填URL或把本机凭据公开。多人协同需双浏览器同时修改/断线重连/权限撤销/AI交错/历史与Undo实际验收，不能只演示轮流保存。

## 8. 复制排除及许可

**必须排除**：根 worktrees/Reference/vben-admin-rutorial/page-prototypes/output/.qa-local/.playwright-cli/.pnpm-store；所有 `.git`/`.idea`/`.vscode`/`.turbo`、node_modules、target、dist、coverage、缓存/日志/crash dump、uploads/业务文件/数据库导出、所有 `.env*`、私钥/keystore/证书/凭据、个人npm/Maven/Git配置、机器路径及本地服务配置。源码 `application*.yml` 不直接照搬，应逐项提取键名重建模板。不要盲复制源 `.github` 发布/部署workflow、脚本或SQL种子后自动执行。

需要保留：Java各模块pom/src及必要测试/资源（配置和种子经审）、UI apps/web-ele与packages/internal/scripts必需子集、锁文件/workspace/catalog/构建配置、许可证/上游版权。源测试若依赖外部MySQL/Redis/OSS，仅在新隔离环境重建，不连源服务。

前端 `UI/LICENSE` 为 MIT，版权 `2024-present, Vben`，复制后必须保留；根package与web-ele也声明MIT。后端正式仓库本轮文件名扫描及git ls-files未发现LICENSE/NOTICE，父POM未见license声明：**需用户/权利人确认Java自有代码与历史来源许可后才公开分发，不能套用FlyMind MIT自动覆盖**。仅用户授权复制不等于上游所有依赖许可都已审清。Java/Maven、Vben依赖及原有第三方资源需另产依赖清单保留原声明；本报告不作法律合规结论。

## 9. 本轮操作、限制与交验

操作仅 Get-Content/Get-ChildItem/rg、Git log/status/ls-files（精确safe.directory临时参数）；未安装依赖、运行构建/测试、开服务、复制全目录、读取环境值或操作数据库。本审计仅新增本报告，未改源仓库、FlyMind源码、版本或台账，未提交推送。随后C01受控复制另获PM授权，复制详情单列ADMIN_COPY_MANIFEST.json与目标README，不改变本报告的静态审计性质。

请求PM审查：正式源选择、Java控制面+独立管理前端的复用边界、账号/团队缺口、C0→C3顺序及复制排除清单。实施前需冻结目的路径、部署数据库/域名、团队模型、本地授权在线/离线边界、协同与MCP授权契约及Java许可；本轮不自行实施。
