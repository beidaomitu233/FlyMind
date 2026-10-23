# C01 统一身份与团队接口契约

日期：2026-10-19。状态：实现契约；未验收前不写入用户调用指南。

2026-10-20 实测补充：受控 Java Jackson 将 Long 时间戳输出为十进制字符串。Node 仅在明确的 `expiresAt`、OAuth `client_id_issued_at` / `expires_in` 数值字段接受正安全整数或等价的十进制字符串，规范化后再执行到期/SDK校验；拒绝空串、空格、指数、小数、布尔和溢出。不转换用户ID、token或任意业务JSON。真实 Node→Tomcat 组合已验证；本地设备授权见 [LOCAL_AUTH_GATE.md](LOCAL_AUTH_GATE.md)，v1.1 实际状态见[台账](../releases/V1_1_EXECUTION.md)。

## 1. 所有权与约束

2026-10-23运维探针：Java回环端口`GET /internal/flymind/readyz`要求真实loopback来源与`X-FlyMind-Gateway-Key`。仅在ApplicationReadyEvent之后、前台凭据/后台关系表可查询、Redis PING成功时返回`200 {ready:true,jarSha256}`；不就绪503，仅`{ready:false}`，错误密钥401。摘要取实际启动JAR；测试classes目录摘要为空，发布器必须拒绝空摘要或与候选不同的摘要。响应不缓存、不返回用户、密码、SQL异常或密钥。Nginx不应将此运维路径列为公开入口。此探针不代替真实后台登录及端到端授权验收。

- 应用代理拥有 `../../xinghui-admin/` 中 Java/Vben 实现；主代理拥有 `server/cloud/` 的身份客户端和工作区隔离。引擎代理当前拥有同步探针及其报告。
- 不改原始星辉路径；只在复制目录实现。Java 数据库、Node 团队数据都使用新的隔离开发目录/数据库，不连接用户原库测试。
- 身份和既有ID/FK复用 `SysUser`；前台密码/状态由独立 `app_flymind_account` 管理，后台密码/状态仍在 `sys_user`。手机号 + 密码受控 `FLYMIND_APP_TENANT_ID`，不开放自助注册。既有普通应用账号及有应用成员/会话历史的双用途账号一次性导入旧哈希，之后互不覆盖；纯后台角色账号不自动获得前台凭据。
- 管理端 JWT 保持兼容且登录必须有启用的后台角色。FlyMind 应用 opaque 会话支持多设备，不以用户 ID 一个键互相踢掉。令牌为至少 256 位随机值；数据库只存摘要，响应 `Cache-Control: no-store`，不记录密码或令牌。
- 团队不是系统租户。可信上下文包含用户 ID、团队 ID、角色和会话 ID。每个业务请求重新检查账号、会话、团队及成员状态；停用/移除不能只靠前端生效。

## 2. 返回格式

延续 Java 的 `{code:200,message:string,data:T}`。HTTP 状态同时正确表达 400/401/403/404/409/429/503，不能始终 HTTP 200。ID 全部序列化为字符串；时间为毫秒 Unix 时间戳。

角色固定 `owner | admin | editor | viewer`，权限固定：

| 操作 | 最低权限 |
|---|---|
| workspace:read / diagram:read / export:read / export:create | 所有有效成员 |
| diagram:write / workspace:write | owner/admin/editor |
| team:manage | owner/admin |
| team:ownership | owner |

## 3. 应用认证

| 方法与路径 | 输入 | 输出 | 说明 |
|---|---|---|---|
| POST `/app/flymind/auth/login` | `{phone,password}` | `{sessionToken,expiresAt,user:{id,name}}` | 公共入口，按 IP/账号限速，错误不泄露手机号是否存在 |
| GET `/app/flymind/auth/me` | Bearer 应用令牌 | `{user:{id,name},expiresAt,teams:TeamSummary[]}` | 检查账号与会话，枚举当前有效成员团队 |
| POST `/app/flymind/auth/logout` | 同上 | `{success:true}` | 撤销当前设备会话，其他设备不受影响 |
| POST `/app/flymind/session/introspect` | Bearer 应用令牌；JSON `{teamId}` | 下述 TrustedContext | Node 云端 API 的身份事实来源，不信任 Node 传入 userId/role |

```ts
interface TrustedContext {
  user: {id:string; name:string};
  session: {id:string; expiresAt:number};
  team: {id:string; name:string; role:'owner'|'admin'|'editor'|'viewer'};
}
interface TeamSummary {id:string; name:string; role:'owner'|'admin'|'editor'|'viewer'}
```

`sessionToken` 只在登录返回；introspect 不回传令牌。待远程 OAuth 实现时新增专用 grant/refresh，不把上述后台/应用令牌直接当成无受众限制的 MCP token。Node 身份客户端只访问管理员配置的固定控制面 URL，不接受请求中提供的上游 URL。

## 4. 团队与成员

| 方法与路径 | 输入 | 输出 |
|---|---|---|
| GET `/app/flymind/teams` | Bearer | `TeamSummary[]` |
| POST `/app/flymind/teams` | `{name}` | TeamSummary，创建者为 owner |
| PATCH `/app/flymind/teams/{teamId}` | `{name}` | TeamSummary，owner/admin |
| GET `/app/flymind/teams/{teamId}/members` | Bearer | `{userId,name,role}[]`，有效成员可读 |
| POST `/app/flymind/teams/{teamId}/invites` | `{phone,role:'editor'|'viewer'|'admin'}` | `{id,inviteToken,expiresAt}`，admin 不可邀请 admin；token 仅返回一次 |
| POST `/app/flymind/invites/accept` | `{inviteToken}` | TeamSummary，必须登录匹配被邀请账号 |
| PATCH `/app/flymind/teams/{teamId}/members/{userId}` | `{role:'admin'|'editor'|'viewer'}` | `{success:true}`，owner 才可授予/变更 admin；禁止改变 owner |
| DELETE `/app/flymind/teams/{teamId}/members/{userId}` | Bearer | `{success:true}`，禁止移除 owner、管理员不能移除同级/更高级 |
| POST `/app/flymind/teams/{teamId}/transfer` | `{userId}` | `{success:true}`，事务转移所有权，原 owner 变 admin |
| POST `/app/flymind/teams/{teamId}/leave` | Bearer | `{success:true}`，owner 必须先转移 |

邀请一次性、摘要存库、默认 48 小时失效；接受与成员插入同事务，并发重复接受不重复插入。团队名 1–80 字、trim 后非空。个人空间是显式 type=personal、唯一 owner 的团队特例，不提供外部成员邀请；首次应用授权创建，重复登录不重复建空间。

## 5. 管理端与储存

平台管理继续走原星辉管理认证和方法权限。至少提供团队列表/成员查看/团队停启用及用户开通/停用，不把普通应用成员提升成平台管理员。新的平台团队 API 前缀 `/admin/flymind/teams`，权限名 `flymind:team:list/query/edit`；使用显式菜单种子，不嵌入测试账号或默认密码。

新增表由 Flyway 管理：`app_flymind_team`、`app_flymind_member`、`app_flymind_session`、`app_flymind_invite`。使用唯一成员约束、会话/邀请摘要唯一索引、外键或等价事务约束。会话有 userId、createdAt、expiresAt、revokedAt，团队有状态。停用账号、团队或删除成员后 introspect 必须拒绝。

Node 数据根：`<FLYMIND_CLOUD_DATA_DIR>/teams/<sha256(teamId)>/`。绝不使用用户输入直接拼文件路径，所有 native 端点、历史、组/回收站、导出/制品都位于授权后的同一 Store。云端不可访问本机原始工作区。

## 6. 必测边界

真实 API 测试：双设备会话、错误密码、退出和停用、过期、viewer 写入、非成员、跨团队同图形 ID、邀请错账号/重放/过期、最后 owner 保护、管理员越权、基础设施故障失败关闭。控制面不可用时返回 503，不能把旧缓存当作长期有效授权。

前端保持原 FlyMind 界面，仅新增登录/账号菜单/团队选择/成员面板；Java 管理端继续使用星辉组件和真实 API。生产用户体验、持久化和权限全部通过后才能声明 C01 已验收。

## C01 管理账号补充（实现切片，待完整环境验收）

- `GET /admin/flymind/users`：当前受控应用tenant内账号；`system:user:list`。
- `POST /admin/flymind/users`：`{phone,name,password}`，管理员开通既有SysUser，固定服务端tenant，不接受tenantId；`system:user:add`。
- `PATCH /admin/flymind/users/{id}`：`{status:0|1}`，仅精确数值0/1；`system:user:edit`。停用与该用户全部app sessions撤销在同一事务，重新启用不恢复旧token。
- `POST /admin/flymind/users/{id}/password`：`{password}`，前台密码至少6字符、非全空白且不超过72 UTF-8字节，BCrypt，限定应用tenant；`system:user:edit`。同事务撤销全部前台session/OAuth/device grants；后台密码保持至少12字符，不向客户端返回密码/hash。
- `POST /app/flymind/auth/password`：应用Bearer，严格body `{currentPassword,newPassword}`；新密码同上6字符规则。成功 `{code:200,message:"成功",data:{success:true,reauthenticate:true}}`；原密码错误 HTTP400/`errorCode:INVALID_CURRENT_PASSWORD`，实际Bearer失效HTTP401。成功撤销该用户全部前台会话/OAuth/device grants，需要重新登录；后台凭据/状态不变。
- bootstrap已显式赋予上述F权限与用户/团队M/C路由。管理端仅手机号+密码及实际captcha；不开放旧模板假注册、扫码、社交、验证码登录或找回入口。

后续FlyMind UI薄适配仍待分配所有权：注入固定身份transport及user/team context，不重画NativeStudio；切团队沿现保存/离开保护。云端IDB草稿须同时按userId+teamId+workspace/dataRoot identity隔离，不只凭diagramId或根身份，以免退出/换账号恢复到另一主体。

AUTH-23起，前台账号停用/密码重置仅撤销前台会话/OAuth/device grants，后台状态、密码及JWT互不影响；此前共用账号时同步撤Admin Redis的行为已由独立凭据取代。旧ID、团队与图形归属不变，不默认重置任何线上密码。
