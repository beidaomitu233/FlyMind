# FlyMind 云化引擎、MCP 与协同审计

日期：2026-10-19。状态：方案待 PM 审查，未实施。范围：只读本地源码、固定供应与已安装 SDK，并查阅官方资料；未启动服务、运行浏览器或访问用户数据库。本文不表示云端、授权登录或协同已经可用。

## 1. 结论与最小方向

1. 保留原有工作台及五类原生绘图引擎。Java 作为统一账号/登录/团队与授权权威，Node 新增独立 cloud 入口；本地 Runtime 保留机器凭据隔离，但补上用户授权门禁。不能把本机 Bearer/cookie 解释为用户身份。
2. 首期可按服务端核验的团队 ID 映射独立 `DiagramStore` 数据根，复用原生应用服务、CAS、请求重放、历史和导出 worker。该方案是单节点/团队固定归属的部署起点，不是多副本共享 SQLite 方案。
3. 远程 MCP 可保留工具注册实现，换成 Streamable HTTP 与受限的进程内服务连接；每个 MCP 会话固定用户/团队/授权主体，后续请求重新检查有效权限。
4. **固定 draw.io 31.5.3 已有公开增量协议**：`load.diffSync`、`patch/getDiff/resetDiff`。优先验证这条路径，避免先做自研白板或维护 vendor fork；原生存储供应商的实时同步后端并未包含在本项目中。
5. 多人协同仍须新增权威 room、操作排序、冲突合并/重基、持久日志、回放与本地 Undo 语义。CAS、全 XML 广播、定时刷新、公开 `merge` 单独都不能满足同时编辑。
6. 现发布包只声明 Windows。Linux 资源路径已有分支，但 CLI、安装、浏览器沙箱、原生依赖及容器生命周期没有本批实际证据，不能直接宣布可上线。

## 2. 代码事实与可复用边界

| 本地位置/函数 | 已有事实 | 云化使用方式/缺口 |
|---|---|---|
| `server/runtime.ts` | 本机 Host/Origin 白名单；SQLite 初始化、原生服务/导出 worker/静态工作台装配 | 保留 local 入口；cloud 新装配，不删除现本机保护后直接暴露公网 |
| `server/runtime-instance/session.ts:runtimeSessionMiddleware` | 实例专属 Bearer、HttpOnly cookie；同源 POST `/session` 可以签发本机 cookie | 没有账号/团队检查；本地也要求登录时必须在此之前完成用户授权，未登录不能通过 bootstrap 绕过 |
| `server/runtime-instance/client.ts:ensureNativeRuntime` | 同数据根单实例、健康能力/身份握手、私有机器凭据 | 是 local 生命周期管理；云端请求不能按 tool 调用启动本机进程或接受客户端 rootPath |
| `server/store.ts:DiagramStore` | 单根 SQLite；diagram ID、workspace_group、request ID 在库内全局；事务/CAS/历史/制品租约 | 团队独立根可以复用；`workspace_groups` 只是列表分组，不是团队成员/权限表 |
| `DiagramStore.commitNativeDrawing`（约171–201行） | 事务外严格验证投影，事务内 revision CAS；no-op 不增修订；历史与请求重放同时落库 | 可作为云端规范文档最终提交点；当前没有用户 actor、团队授权或协同操作日志 |
| `server/application/native-diagrams.ts` | `createAI/patchAI/updateAI/saveEditor/configureRendering` 等共享业务规则 | UI、MCP、协同应最终调用同一服务；权限不放到各工具自行重复实现 |
| `server/mcp-native/server.ts:createNativeMcpServer` | schema、工具、导出/资源读取已经集中；连接缓存绑定 `dataRootId`，失效不自动改绑 | 保留注册层；提供固定授权上下文的 service connection，不能跨团队复用同一个 facade |
| `server/mcp-native/index.ts` | `StdioServerTransport` | 新增 HTTP 入口，保留 STDIO；HTTP 的 OAuth 流程不直接套到 STDIO 线上流 |
| `src/drawing/engine/drawio-host/controller.ts` | origin/source/session 隔离、公开 load/save/export 等关联请求 | 现协议没有 diff-sync 接入；协同扩展须保留严格消息来源和会话隔离 |
| `src/drawing/state/native-session.ts` | 单人保存串行、CAS/恢复草稿与 ACK 不覆盖更新输入 | 可保留单人/非协同路径；不能直接作为 room 合并器 |
| `src/drawing/engine/drawio/{index,normalize,projector,patch}.ts` | 纯内容编译、严格投影、归一化、局部结构修改 | 服务端用来验证规范文档；不对每次远端变化全图 compile/reflow |
| `server/exports/{worker,artifacts}.ts`、`server/rendering/*` | 不可变修订快照、租约 fencing、固定原生 PNG/SVG 与字体封装 | 增加团队/主体访问与全局预算；继续按已提交快照导出 |

### 2.1 建议最小身份/服务契约（规划，非现有导出）

```ts
type AccessContext = {
  userId: string; teamId: string; clientId?: string;
  permissions: readonly string[]; authzVersion: string; sessionId: string;
};
authorize(context, action, resource): Promise<void>;
teamServices(context): Promise<{ store; diagrams; exports }>;
```

- Java 登录产生可验证的主体；团队切换必须由 Java 核验成员关系后建立新上下文，不信任裸 `X-Team-Id` 或 tool 参数。Node 仅信任受保护内部通道中的签名凭证/有效访问令牌，防止绕过网关伪造头。
- Node 根据内部不透明团队存储键定位根目录：目录不由用户输入拼接，不接受绝对路径/`..`。初始化前校验租户与存储归属；个人空间可映射为个人团队。角色建议 owner/admin/editor/viewer，具体权限表由身份侧冻结。
- 每次读/写/下载/导出/回收站/备份/room join 都检查权限；邀请撤回、成员移除和角色降低影响已有 HTTP/MCP/WS 会话，不能只在登录时检查。
- 当前 requestId 在单团队库内唯一；多用户会碰撞或重放他人响应。云端幂等索引至少绑定 `(teamId, actor/client identity, requestId)`，payload 与身份一起哈希；不能只依赖随机键“通常不碰撞”。
- 单团队根内部没有项目级授权。若产品需要同队部分成员不可见某图，需在服务/目录查询与制品路由引入 diagram/project ACL；不能把 team 根隔离当作细粒度授权已完成。
- Store 注册表须有容量/空闲回收、团队 worker 懒启动和全局并发限制。不能每团队无界常驻一个浏览器，也不能在请求中全局切换 `process.env.FLYMIND_DATA_DIR`。
- SQLite 首期要求单文档 room 和团队数据库有明确唯一写入所有者；多副本需分片路由/持有者 fencing。共享网络盘或每副本拷贝 DB 不提供一致性；后续数据库替换要保持服务/修订契约。

### 2.2 本地也需授权

新增 CLI 登录/退出/授权状态入口，采用系统浏览器授权与受保护本地凭据存储。STDIO 本身不承载浏览器 OAuth HTTP 回调协议。机器实例凭据仍用于 IPC/回环，不取代用户会话；本地启动、cookie bootstrap、工具写入与敏感下载都经过授权检查。

是否允许离线、允许多久、退出/撤权后能否只读导出本地数据，是待 PM 冻结的产品策略；不能宣称纯本地可彻底防止机器所有者修改开源程序绕过授权。不要静默上传既有本地 SQLite；本地导入云团队应另有明确用户操作和失败回滚。

## 3. 单链接远程 MCP

### 3.1 本地 SDK 证据

已安装 `@modelcontextprotocol/sdk` **1.32.1**，检查的是 `node_modules/@modelcontextprotocol/sdk/dist/esm` 下声明/实现，不依据在线最新 SDK 猜测：

- `server/streamableHttp.{js,d.ts}`：`StreamableHTTPServerTransport`、`handleRequest`。
- `server/webStandardStreamableHttp.d.ts`：`sessionIdGenerator`、`onsessioninitialized`、`eventStore`、JSON/SSE 响应选项。
- `server/auth/router.d.ts`：`mcpAuthRouter`、`mcpAuthMetadataRouter`；后者适用于授权服务器另由 Java 提供的资源服务器。
- `server/auth/middleware/bearerAuth.d.ts`：`requireBearerAuth({verifier, requiredScopes, resourceMetadataUrl, expectedResource})`。必须设置 audience/resource，不能依赖默认未比较状态。
- `server/auth/provider.d.ts`：授权服务 provider/token verifier 的接点。SDK 帮助提供协议路由，不自动实现用户账号、团队权限或 token 存储。

### 3.2 拟定 HTTP 契约

对外一个稳定 HTTPS 地址（例如 `https://<域名>/mcp`）；认证发现端点由客户端自动发现，用户不复制 query token。OAuth 2.1 授权码/PKCE、资源 metadata、resource audience、token 每请求校验是协议基线；不透传错误 audience token。OAuth 2.1 在引用版本仍是 IETF draft，不标成已发布 RFC。来源：[MCP authorization 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)。

应用方案：

1. Java 管登录、同意授权、团队选择、令牌与撤权；Node 作为 MCP resource server，暴露 protected resource metadata，401 指向该 metadata。Node 核验 issuer/audience/有效期/scope，并查询仍有效的团队授权。
2. `/mcp` 处理 POST 与可用的 GET/SSE、DELETE；协议版本、session header、恢复流沿 SDK 实现。反向代理保留 streaming，禁止 SSE 缓冲；请求断线不解释为服务端操作撤销。来源：[MCP transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)。
3. 建立会话时固定 `(userId, teamId, clientId)`；sessionId 不是鉴权凭据。后续 Bearer 属于不同用户/团队时拒绝，切团队重建会话。SSE 重放事件和 resource URI 也必须匹配原主体/团队。
4. 权限可按 diagrams:read/write、exports:read/create、teams:read 等冻结；SDK `expectedResource` 指向实际公开 canonical MCP URL。注册方式需验证目标 MCP 客户端：预注册或协议支持的发现/注册，不假设每个客户端都支持动态注册。

### 3.3 复用现 facade 的进程内连接

`createNativeMcpServer(connect)` 当前实际消费 `baseURL/dataRootId/authenticatedFetch/close`（以及交付身份校验）。建议把连接参数类型抽成这部分 `NativeServiceConnection`，local 的 `NativeRuntimeConnection` 结构兼容；不为了云端伪造机器 sessionToken/instanceId。

`authenticatedFetch(relativePath, init): Promise<Response>` 的 cloud adapter 只调内部已授权服务或受控路由适配，不访问任意公网地址；固定来自会话的 `AccessContext`，每请求重新 authorize，拒绝调用者覆盖团队/Authorization。不是浏览器提交哪个 team 就切哪个 Store。

- facade 维持既有 dataRootId 绑定，不使用 `ensureNativeRuntime`，不每 tool 初始化/改绑根。
- 每会话拥有自己的 facade/transport；不能把缓存 `connection` 的单个 facade 共享给所有用户。若选择无状态 HTTP，也须每请求构造隔离授权上下文，不能全局可变主体。
- adapter 的 `Response` 要完整支持 JSON 错误、状态码、PNG/SVG/文件体及字节预算；导出内部 URL 不能返回 `127.0.0.1` 或文件路径。`editorUrl` 改为可恢复团队上下文的云前端链接；私有制品下载继续权限校验，或使用有时效且绑定目标制品的下载授权。
- `flymind://exports/...` 当前未含团队命名空间；跨会话资源读取必须从固定上下文解析并再授权，必要时给 URI 增加不透明 workspace 标识，不能“知道 URI 即可下载”。
- MCP 限流、工具超时与导出异步任务应区分；超时后相同幂等键能查询原结果，不盲目再创建。

## 4. 真正同图实时协同：固定版本的可用入口

### 4.1 重要版本证据

本次本地哈希与 `resources/drawio/supply.json` 核对 **6/6 相同**，其供应绑定官方 31.5.3 WAR；以下不是从最新版文档反推本地能力。

| 文件 | SHA-256/关键位置 |
|---|---|
| `js/app.min.js` | `af2cf82ab8c39c7c1b15c69cd9ffaa528cea0bb6e91f60460a01dbbf49be6f7e`，含 `embedDiffSync` |
| `js/diagramly/EditorUi.js` | `8d52454918aa1182e1ed63476d82a3abd296993524b5c91415805dbaea8cb47b`；26769 load.diffSync，27173 patch，27216 getDiff，27235 resetDiff |
| `js/diagramly/DrawioFileSync.js` | `c4f819de3dd588a114a1866b26c749abea72fecd5d5a9983375123add2d8c593`；362 start，491 initRealtime |
| `js/diagramly/DiffSync.js` | `6700603abf4f832d300e0313bbfa427bc1fd003394fe21abe6e895e5ffad73ca` |
| `js/diagramly/P2PCollab.js` | `553568416e2813c35e856cab43802f8d062ac4ebca843fe50cb989303e64bd4e` |
| `js/PreConfig.js` | `b8655ef28c207ec5e8d3ac207a26d5311499e0be8b97ee08aae9154d69199a07`；13行 `sync='manual'` |

公开协议 `load {diffSync:true}` 开启增量 autosave；`patch` 应用变更并返回 checksum，`getDiff/resetDiff` 提供差异及影子状态恢复。源码 `patch` 分支调用 `file.patch` 并更新 shadow，抑制回声事件；这支持增量适配，但没有替 FlyMind 实现多人房间。参见[官方 embed 协议](https://www.drawio.com/docs/reference/embed-mode/)。**本批仅源码确认，未运行该增量路径；checksum 算法/消息格式和 Undo 行为须在 spike 实测冻结。**

另一条原生路径 `DrawioFileSync/P2PCollab` 依赖文件、channel、cache/通知等后端；`DrawioFile.isRealtimeSupported()` 默认为 false，`DriveFile` 覆写为 true，当前 `LocalFile` 继承基类。官方说明开源存储后端不自带实时协同服务：[Storage Backends](https://github.com/jgraph/drawio/wiki/Storage-Backends)。官方在线实时能力主要随 Drive/OneDrive 存储提供，不能当作 FlyMind 自建后端已经可用：[官方并发编辑说明](https://www.drawio.com/docs/manual/collaboration/concurrent-editing/)。

### 4.2 推荐最小 room 契约（待实验冻结）

```ts
RoomKey = { teamId, diagramId };
Submit = { clientId, opId, baseSeq, baseRevision, nativePatch, protocolVersion };
Accepted = { seq, revision, opId, canonicalPatch, checksum };
```

- join 校验读/写权限，返回规范快照、revision/seq、同步协议和精确引擎/adapter 版本；room 身份不由任意客户端 path 决定。presence/cursor 是临时消息，不改变图形 revision。
- 每 room 单一写入排序器；opId 幂等，baseSeq 有界历史重放。**仅顺序广播不足以合并基于旧 shadow 的并发操作**：必须采用被验证的原生 diff/rebase 语义，或转换成定义明确的字段/树/端点操作并处理冲突；不能声称普通 last-write-wins 整文档已经收敛。
- 格式只接受受限 native model changes；XML/HTML/图片/外链资源仍经现严格解析和预算，不能允许客户端发送任意 JavaScript/动作。普通绘图不重新布局。
- 服务器维护权威 native 状态；保留客户端原生 cell IDs、业务绑定和装饰。复制分配新业务 ID、ack 元数据落后、父子/跨泳道、删除端点、受控条目顺序均沿现 normalize 规则，并通过增量回传，不能覆盖正在编辑的新 XML。
- 对同字段冲突、同时删除/移动/重连、group、controlled items、lock、Undo 必须书面定义结果；远端操作不进入本地普通 Undo 栈，撤销本地操作不撤销他人的新修改。不得把现属性提交的 load 清空 Undo 边界用于每次协同更新。
- native 未完成的文字/无效归属是草稿，不伪造成功项目修订。最小版只提交完整可验证事务；被拒绝的本地操作保留可恢复草稿并明确状态，不能服务器暗删残线。是否广播未成业务的临时形状需要另定草稿协议。

### 4.3 人与 MCP 统一提交

room 为同一文档所有写入口的顺序点：原生事务、AI content patch、属性修改、重排均进入 room，不能 MCP 绕过 room 直接 CAS 后再通知。

1. 人工事务验证得到规范 XML/投影，调用现 Store 提交，产出唯一业务 revision。
2. MCP `get_diagram` 返回该 revision；patch 使用 expectedRevision，经 room 内顺序检查再执行 `patchDrawio`，只重路由受影响边，保留人工几何。
3. 规范提交和待广播事件使用事务 outbox/等价持久机制绑定；现 Store 尚无此接口，不能先写库再仅靠内存广播防丢。提交成功后 ACK，重复 opId/requestId 返回原结果。
4. room 的操作 seq 与正式 document revision 建立明确对应；批处理或被拒草稿不混入“已保存”修订。导出始终固定一个正式 revision/snapshot，不导出半个事务或房间最新未提交内存状态。
5. 节点实例崩溃后回放已提交日志并重建 room；多副本抢同 room 须 fencing，客户端重连补齐日志，checksum 不同进入可见恢复路径，不静默覆盖输入。

现 native XML 公共 diff 的服务器应用是否能纯 Node 安全复用，还是需要受限 headless 原生模型宿主，是首个 spike 的主要难点。不能只凭 `.patch` 入口存在承诺零适配成本；若需模型 change codec 桥，应放专用版本适配模块，不让父页直接调用 graph 或自研手势。

## 5. Linux 与线上渲染/部署约束

| 事实 | 上线前需闭合 |
|---|---|
| `package.json.os=['win32']`，`bin/flymind.mjs` 拒绝非 Windows | 云端使用独立 entry/image 构建目标，不悄悄取消本地已声明支持范围 |
| `server/rendering/assets.ts` 已有 Linux headless 路径 | 仅路径分支，不是 Linux 可运行证据；CI 安装同一 PW1.62.1 registry 对应 Linux 二进制和依赖 |
| draw.io31.5.3、OTF、许可证有固定 SHA，`.gitattributes` 保字节 | 镜像构建时准备并校验资源；服务启动不临时访问互联网/下载，记录镜像 digest/供应 manifest |
| 当前 `hidden-browser.ts` 显式 `--no-sandbox`；非 Windows 强杀只杀 child | SaaS 对不可信图形必须审浏览器隔离；非 root、沙箱/容器隔离、seccomp、资源/网络预算、进程树清理和僵尸回收实测。不能照搬 Windows 通过结论 |
| worker 会渲染用户 XML，CPU/内存/字体/SVG 体积可较大 | 每租户队列配额+全局并发/像素/字节/超时；独立 context/profile；故障任务不能泄漏后续租户数据 |
| 本地制品/SQLite 在数据根；Runtime loopback | HTTPS 反向代理、内部服务身份、持久卷备份、制品对象存储/授权下载和灾难恢复另装配；不把用户根目录作为静态网站公开 |
| better-sqlite3/sharp 为原生依赖 | 固定 Node/架构/发行版构建验证；不能用 Windows node_modules 复制进 Linux |

官方 Playwright 文档要求容器中的浏览器/系统依赖与包版本匹配，并说明非 root 与 sandbox/seccomp 的关系。本文不采用网页当前展示的较新版本升级本项目；仍以已锁1.62.1为起点进行 Linux 验证。[官方 Docker 说明](https://playwright.dev/docs/docker)。

## 6. 建议阶段与验收门槛

| 阶段 | 最小可审产物 | 必须实际验收 |
|---|---|---|
| C0 契约及风险 spike | 主体/团队、权限、room/revision、MCP连接接口冻结；固定 diff-sync 实验；Linux 小样渲染 | 两真实浏览器增量往返及远端不回声；同字段/删除重连/本地 Undo；纯 Node 或原生宿主服务器 patch 可行性；Linux中文PNG/SVG/子进程清理 |
| C1 统一账号与隔离 | Java 登录/授权/团队；本地登录门禁；Node cloud 可信上下文+团队Store注册 | 两用户两团队全部列表/ID直读/资源URI/下载/导出/回收站不可越权；撤权即时生效；本地未登录不能bootstrap/STDIO绕过；数据不自动上传 |
| C2 单链接 HTTP MCP | 公开HTTPS/MCP OAuth metadata/Java AS联通；同 facade 受限adapter | 真实目标客户端从URL完成登录，5型创建/patch/导出；错issuer/audience/scope、盗用session/跨团队、断线重放拒绝越权，重试不重复写 |
| C3 真协同闭环 | 权威room+版本适配+durable outbox+重连/Undo | 两人同图同时改不同和相同cell；一人移动一人重连/复制/删除；中文输入法；MCP实质修改加入；所有端投影/geometry/signature/修订一致，不靠reload或丢输入 |
| C4 线上可发布 | Linux镜像、TLS、持久存储/备份、审计与指标、配额和升级回滚 | 并发/崩溃恢复/租约fencing/资源隔离/备份恢复及固定快照导出；账号注销/撤权；外网真实登录与下载；单链接远程MCP持续可用 |

阶段可并行：身份契约、固定 diff-sync spike、Linux供应诊断。C1/C2不标成实时协同，C3不因CAS/刷新可用就通过。线上只读分享若纳入“发布在线”，另定义可撤销分享授权和指定修订；默认不公开团队图或永久下载链接。

## 7. 需 PM 冻结的决策与未决风险

- Java 账号后台实际工程/接口未在本次 `flyMind` 中找到（只读搜索未见 Java 源文件）；保留 Java 的建议来自 PM 架构方向，不能据此声称已经支持 OIDC/OAuth2.1、团队或撤权。需身份代理提供准确可用 API。
- 授权服务器/账号提供商及登录方式、角色与项目级 ACL、个人空间语义、本地离线授权期限、SaaS 数据地域/留存/备份与付费限额需产品决定。
- 固定公开 diff-sync 源码已确认，但真正并发合并/服务端 patch/Undo/输入法尚未实测。若这些不能闭合，应退回协同适配设计；不得用CAS冲突提示替代需求。
- Store 复用能减少重写，但需补 actor/幂等命名空间/outbox，且多租户备份/导入恢复也要权限门禁；不能把健康dataRootId作为授权凭证。
- 浏览器沙箱与文件/外链安全需要 Linux 实测；现强制 no-sandbox 是明确差异，不能隐藏为普通部署参数。
- 官方资料是协议/实现依据，不是本项目验证结果。仅改本报告；未改版本、依赖、生产代码、用户数据，未提交推送。
