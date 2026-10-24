# U30 账号、团队邀请与真实统计

状态：开发切片待 PM 验收；未部署、未应用生产迁移。正式 Java 源为 `integrations/xinghui-admin/backend`，不是上级历史副本。

## 账号与用户 ID

- 内部 `sys_user.user_id`、团队关系与图形关联不变。新增 `app_flymind_user_code`，六位大写字母/数字，至少各一种，唯一索引；随机碰撞有限重试。
- 受控 tenant 的既有前台账号启动时幂等分配；新开通账号立即分配。用户 ID 不随改名、密码、团队变化。
- 登录、`GET /app/flymind/auth/me` 的 `user` 增加 `userCode`；成员及管理用户列表增加同字段。内部 `id/userId` 仍用于授权和关联，不作为对外用户 ID。
- `POST /app/flymind/auth/password` 与 `/cloud-api/auth/password` 仅接收 `{newPassword}`。成功 `{success:true,reauthenticate:true}`，撤销该用户全部前台应用会话、OAuth grant、设备 grant，Node 清 cookie。无需旧密码/重复确认；仍须当前有效会话、同源与固定用户身份检查。
- 前台新密码至少六个 Unicode 字符，非全空白，UTF-8 不超过 72 字节；不要求字符组合。后台管理员密码策略不变。

## 团队邀请

Java 以下路径前缀 `/app/flymind`；浏览器代理前缀 `/cloud-api`，仍使用 HttpOnly 会话和 `X-FlyMind-User-Id` 写保护。

| 方法与路径 | 输入/输出 |
| --- | --- |
| `POST /teams/:teamId/invites` | `{userCode,role}`，用户 ID 统一大写；返回 `{id,expiresAt}`，不返回邀请令牌 |
| `GET /invites` | 本账号邀请列表 `{id,teamId,teamName,inviterName,inviterCode,role,createdAt,expiresAt,status}`；status 为 pending/accepted/declined/expired |
| `POST /invites/:id/accept` | 无业务 body；成功返回团队 `{id,name,role}` |
| `POST /invites/:id/decline` | 无业务 body；成功 `{success:true}` |

重复同角色待处理邀请复用原 ID；不同角色待处理邀请返回 `INVITE_ALREADY_PENDING`；已成员返回 `ALREADY_MEMBER`。接受仍检查收件人、时效、原邀请者管理权限、团队状态和角色上限。个人空间不能邀请。并发接受通过事务锁及成员主键保护，不重复入组。接受前先执行现有离开/保存保护，取消不写服务器。

旧 token 接受服务保留兼容，新增公开邀请不生成可见 token 工作流，UI 不要求用户复制粘贴令牌。UI 的“加入团队”展示收件箱，非待处理项只读显示结果；账号切换时清理列表。

## 管理看板

`GET /admin/flymind/overview?days=7|30`；权限 `flymind:dashboard:view`。沿用既有管理 JWT，不对前台 token 开放。目录：一级“数据看板” `/dashboard`（M，ID 90004，parent 0，order -100），最前；子页“应用概览” `/dashboard/overview`（C，ID 90005，parent 90004），组件 `dashboard/analytics/index`。

返回 `generatedAt, timezone:'UTC', days, activitySince, users, teams, invites, authorizations, trend, definitions`。

- `users`: total/enabled/disabled，仅受控 tenant、未删除前台账号，不包含纯后台管理员。
- `teams`: total/enabled/disabled，当前有本 tenant 成员的空间，包含个人空间；members 是成员关系数，不是去重人数。
- `invites`: pending/accepted/declined/expired，四种互斥状态。
- `authorizations`: activeMcpGrants/activeDevices，账号及空间启用、成员仍存在、未撤销且未到期的 grant 数，不代表在线人数。
- `trend`: 每日 date/newUsers/loginUsers/loginCount/activeUsers。newUsers 按前台 credential 创建时间，旧账号兼容迁移时不推测历史注册日；loginUsers 是成功密码登录去重用户，loginCount 为成功次数；activeUsers 是成功通过应用会话鉴权的去重用户，不包含 MCP/device 专用 token 访问。
- `activitySince`: 最早实际采集事件时间，尚无事件则 null。早期零值表示无已采集事件，不代表追溯统计了历史活跃。
- 不返回无来源的图形统计，不用假零代替跨服务数据。

既有 Java Jackson 配置把 Long 序列化为十进制字符串；前端对计数/时间使用 `Number(...)`，内部 ID 保持字符串。

审计表仅保存 user_id、UTC 日期、成功登录次数、首次/末次成功访问时间；不存密码、token、IP、业务正文，不默认清理。

## 迁移与验证

新增 `V20261024_01__flymind_user_directory.sql` 与 `V20261024_02__flymind_overview_menu.sql`。菜单固定 ID 90004/90005，已符合定义的重复执行不写；其他业务占用同 ID 时拒绝，不覆盖。bootstrap 兼容迁移已建立的菜单并授权两级导航。

### 新迁移发布审核（上线前审核记录）

- `_01` 仅新增用户 ID 目录、最小日访问统计表与邀请 `declined_at` 列；保持内部 user ID/FK、原密码与现存团队/图形不变。六位用户 ID 由应用目录逻辑幂等分配，不由 SQL 猜测或重建账号。
- `_02` 仅新增固定两级看板菜单及既有平台管理员角色授权；90004/90005 被不兼容业务占用时故意失败，不覆盖原菜单。此冲突须部署前在目标环境审核，不能以忽略 SQL 错误放行。
- 现 root 私有 `allowedMigrations` 仍是完整严格清单。两个新 SQL 不在已批准 inventory 时，发布器在停服前拒绝；不修改旧 Flyway SQL，也不由候选包或部署账号自动扩大白名单。
- 发布审核须使用成功 Actions 的**实际 Linux 打包 JAR**及同 run `control-plane-runtime-evidence.json`，确认所有既有迁移名/原字节摘要不变、仅追加上述两项，并绑定 source/JAR 摘要。工作树换行或本地源码摘要不能代替该证据。通过审核后由受控 root 配置流程追加清单，再执行同候选 Java→应用晋级；本批未操作服务器、root 策略或数据库。
- 迁移是增量 schema 变更，但 Java 启动失败不代表数据库自动回滚；仍沿用实际备份、readiness 和既有 stop-on-failure/recovery marker 策略，不能将回退旧 JAR 宣称为回退数据库。

真实 MySQL/Redis JAR gate 脚本为 `scripts/control-plane-runtime-smoke.mjs`（仓库无同名 `scripts/control-plane-smoke.mjs`）。本次修正改密只发送 `{newPassword}`，增加第二个独立前台账号→六位用户 ID 邀请→受邀收件箱 pending→接受后 accepted→两成员核验→看板实际两用户/一已接受邀请及 UTC 趋势检查。无邀请令牌粘贴或旧密码前置。`node --test tests/control-plane-runtime-smoke.test.mjs` **7/7 通过**，含丢失邀请/虚假大计数必须拒绝；这是脚本协议与失败门槛测试，本次未重跑真实 MySQL/Redis，新增完整 gate 的实际执行仍由 Actions 验收。原账号与团队实页证据保留。

### 发布后目录缓存兼容修复（待修复版上线复验）

目标 `run-40071395983-1` ready 后，线上账号实测登录成功但默认 `/admin/#/dashboard/overview` 显示404。只读诊断：`user/router` 正常响应仅3个旧菜单、无 dashboard/overview；`user/info` 包含合法平台管理员角色却没有新增看板权限；同次新登录 JWT 直接 GET overview 成功返回 UTC 7天真实数据。因此已确认新授权生效，旧 Redis info/router 元数据缓存跨 Java 重启保留，不能误报迁移未执行或改写已批准 SQL。脱敏证据为 `output/playwright/u30-production/{account-report,route-diagnostic,permission-diagnostic}.json` 及 `admin-failure.png`。

修复统一 `RedisConstants.USER_INFO_PREFIX` 与 `USER_ROUTER_PREFIX` 目录缓存命名空间为 `v20261024`，所有现有读取、写入及定向失效同步使用；`ADMIN_LOGIN_PREFIX` 不变，旧两类缓存按原1800秒 TTL 自然过期。不 flush Redis、不撤销既有登录、不硬编码放行路由/权限、不修改 SQL。后续菜单/权限目录迁移需要同步提升此 catalog revision，防止升级继续读取旧目录；它是内部缓存版本，不是应用版本。定向 Mockito 测试保留旧命名空间缓存并验证服务不读取它，重新从权威 mapper 构造含 dashboard 的目录及权限；实际同账号浏览器复验须等修复版发布，不能用当前 CI/单测替代。

定向 `FlymindAdminCatalogCacheTest` **1/1 通过，0失败/错误/跳过**；固定 Maven 3.9.11/JDK17执行 `-s build-settings.xml -pl system-admin -am -Dtest=FlymindAdminCatalogCacheTest -Dsurefire.failIfNoSpecifiedTests=false test`，日志 `output/u30-admin-cache-targeted.log`。首次 fixture 发现 Mockito 对 List 返回默认空列表而非真实 Redis miss 的 null，已显式模拟新命名空间 miss；未修改产品查询/构树逻辑迎合测试。

定向 Java 36/36、无跳过：HttpRuntime 10、Identity 11、OAuth 12、Bootstrap 1、AppAccounts 2；包含 Node→真实 Java Tomcat 组合。日志 `output/u30-java-verified.log`。H2/MySQL 模式、Mock Redis，不等于真实 MySQL/Redis或生产迁移验收。

Node client 15/15：`output/u30-client-verified.log`。改密代理定向 1/1（名称过滤其余 9 项未执行）：`output/u30-password-http.log`。早期整个 cloud-http 执行 24/25，唯一失败为既有后台 worker 冷恢复计数，不修改该无关产品逻辑，留 PM 独立复验。

首轮 Java 未限制 heap 出现本机 native memory allocation 失败；后续设置 Maven `-Xmx384m`、测试 JVM `-Xmx512m -XX:ActiveProcessorCount=2` 已正常完成。该轮自动测试结束后无常驻服务；无用户数据库操作、无提交推送。后续显式驻留验收入口见下节。

最终一级菜单与设备父会话注销后的有效授权计数追加复验：HttpRuntime 10 + Bootstrap 1，11/11、零跳过，见 `output/u30-http-menu-final.log`。服务端 `tsc -p tsconfig.server.json --noEmit` 通过。前端 vue-tsc 本批组件无错，整项受并行 `NativeStudio.vue:86` 缺 technical 类型标题映射阻塞，留 PM 所有文件收口；未擅改其文件。未运行 UI 浏览器或 Vite build。

独立复验命令：设置临时随机 `JWT_SECRET`，`MAVEN_OPTS=-Xmx384m -XX:ActiveProcessorCount=2`；使用本机 Maven 3.9.11，`-f integrations/xinghui-admin/backend/pom.xml -s integrations/xinghui-admin/backend/build-settings.xml -Dtest=FlymindHttpRuntimeTest,FlymindIdentityTest,FlymindOAuthTest,FlymindBootstrapTest,FlymindAppAccountsTest -Dsurefire.failIfNoSpecifiedTests=false "-DargLine=-Xmx512m -XX:ActiveProcessorCount=2" -Dflymind.nodeExecutable=C:/nvm4w/nodejs/node.exe test`。仅测试临时 H2，不设置真实数据库参数。

## 本机真实 Java UI 验收入口

显式 JUnit 驻留方法 `FlymindHttpRuntimeTest#serveIsolatedUiFixture`，由 `-Dflymind.uiHarness=true` 启用；正常测试不启用它。使用同一个真实 Tomcat/H2/Mock Redis 环境，独立创建前台 Alice/Bob，以及没有前台 credential 的后台管理员。管理员真实登录、信息、路由和统计预检通过后，启动 `tests/fixtures/u30-ui-harness.mjs`。

- 前台 `http://127.0.0.1:5208/#/cloud`，后台 `http://127.0.0.1:5208/admin/`。
- `/cloud-api` 使用真实 Java 应用会话；`/api` 固定转发本次回环 Tomcat；`/admin/` 读取正式 `integrations/xinghui-admin/frontend/apps/web-ele/dist`，绘图端读取 `dist`。不是 5206 的身份替身。
- 账号、fixture 随机密码、六位用户 ID、控制面随机端口只写入 `output/u30-ui-private/connection.json`；目录和该文件限制 owner ACL/POSIX 0700/0600，不输出密码或 JWT。
- 数据仅写新建 `output/u30-ui-private/data`。已存在私有目录时拒绝重新初始化，不覆盖验收现场。
- 创建同目录 `stop` 文件后，Node 停止接收并等待排空、关闭 HTTP/renderer，JUnit 随后结束；最长驻留四小时。只管理本次子进程。下次验收由操作者保留/移动该私有目录后重新启动，不自动删除。
- 启动参数沿用上述 Maven 命令，将 test 选择改成 `-Dtest=FlymindHttpRuntimeTest#serveIsolatedUiFixture`，追加 `-Dflymind.uiHarness=true`。JWT_SECRET 仍临时随机，不能打印。

已实际通过 5208 检查：两前台账号登录→me 用户 ID→邀请收件箱；独立后台登录→info→router→overview；两端静态 HTTP 200。安全摘要见私有目录 `api-ready.json`，启动日志 `output/u30-ui-harness.log`。未运行浏览器 UI，团队完整手势由 PM 继续验收；没有验证真实 MySQL/Redis、公网 OAuth 或生产部署。

### UI 标签收尾

CloudStudio 对外统一称“用户 ID”，协议仍为 `userCode`，内部 userId 不变。账号信息提供一枚复制按钮，仅复制当前真实六位 ID；成功显示勾选，剪贴板不可用时显示可恢复错误，不伪称复制成功。邀请码输入与 aria-label 同步为用户 ID。PM 的 `activeDialog` 密码分支修复保留，本次不改鉴权或密码契约。

当前 5208/Tomcat 隔离环境按 PM 要求继续驻留供实页验收，未停止；新增标签/复制功能仅作源码检查，等待 PM 集中构建和浏览器复核，不冒称已通过实页。Java/Node 既有定向结果仍以上述日志为准。

### 已保存图离开时的草稿等待竞态

PM 在 5208 实页发现：F2 改名已保存后创建团队，离开校验误报未备份。源码根因是原生 save 事件先异步 `edit(xml)` 写 IDB，而随后 capture 得到同 XML 时直接返回；语义 clean 的 flush 同样直接结束，离开校验可能读到写入中的 `backedUp=false`。

增加 `NativeSaveSession.waitForBackup()`：等待稳定的最新持久化队尾，并保留真实写失败；相同 XML edit、clean flush 与 validateLeave 读取最终快照前均等待该边界。不重试失败写入、不伪造备份成功，不更改数据或保存请求语义。

`node --import tsx --test tests/native-session.test.ts` 32/32、无跳过，日志 `output/u30-leave-session.log`。新增受控延迟测试证明重复 capture/clean flush 在 IDB 完成前不会放行、完成后无需网络写；配额失败仍抛原错误且不新增写/请求。5208 仍保持运行，真实 UI 复核由 PM 构建后完成。

### Windows 验收夹具的菜单 UTF-8

SQL 源与编译资源字节一致，均为正确 UTF-8；乱码来自测试夹具 `ScriptUtils.executeSqlScript(connection, Resource)` 使用 Windows 默认 GBK 解码。将 UTF-8 的“数据看板”误按 GBK 读取可精确重现“鏁版嵁鐪嬫澘”。不是用户 ID 回填类读取 SQL，也不是前端标题问题。

夹具与菜单测试改用 `EncodedResource(..., StandardCharsets.UTF_8)`，Bootstrap 测试增加“数据看板”“应用概览”的精确断言。独立 Java/H2 在 `-Dfile.encoding=GBK` 下执行实际菜单迁移两次，中文精确值及幂等均通过：`output/u30-menu-utf8-check/result.log`；未并发改动驻留 JVM 的 target。

生产入口使用 Flyway（默认 UTF-8），不走这条 ScriptUtils 测试路径；本次未更改生产 SQL 内容或生产库。此结论不替代生产部署验收。

PM 完成旧夹具团队/PNG 验收后明确允许重启：旧 Node/Java 正常停止，整个旧目录归档为 `output/u30-ui-private-before-utf8-20261024015214`，包含原 Node SQLite，未删除。纯 H2 团队重置；新夹具仍使用 5208，同路径 `connection.json` 更新为新的 fixture 账号信息。通过真实 `/api/user/router` 精确验证两条中文，见新私有目录 `utf8-menu-ready.json`。原浏览器会话需重新登录；没有操作用户库。
