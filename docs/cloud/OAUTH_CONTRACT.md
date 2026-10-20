# C02-O 远程 MCP 授权契约

日期：2026-10-19。实现基线，未完成联调前不是可用能力。Java 保管账号、OAuth 客户端、授权请求、grant 和令牌摘要；Node 提供标准 OAuth 发现/端点及 MCP 资源服务，不保存另一套密码。固定资源为 `${FLYMIND_CLOUD_PUBLIC_ORIGIN}/mcp`。

## 1. 公共与内部边界

- Node 根挂 SDK `mcpAuthRouter`，公开 discovery、`/register`、`/authorize`、`/token`、`/revoke` 和 `/mcp`。开发仅显式回环 HTTP；生产 HTTPS。客户端仅一期 public + PKCE S256，`token_endpoint_auth_method=none`；redirect URI 精确匹配注册值，HTTPS 或回环 HTTP，拒绝 fragment/用户密码/通配符/非回环 HTTP。
- Node 到 Java 固定 origin `/app/flymind/oauth/*`，均附 `X-FlyMind-Gateway-Key`，双方配置同一个不少于32字节的随机 `FLYMIND_GATEWAY_KEY`，恒定时间比较，缺省拒绝启动/拒绝 OAuth。该密钥不能下发浏览器。Node 禁止代理任意 OAuth 路径、日志令牌或错误中的 SQL/路径。
- Java 所有内部成功返回既有 `{code:200,message,data}`；OAuth 错误 HTTP 400/401/403/429/503，`data` 可带标准 `error`，Node 映射为 SDK OAuthError，不能透出内部堆栈。

## 2. 内部端点（JSON，除 GET 外 POST）

| 路径（省略 `/app/flymind/oauth`） | 输入 | data |
|---|---|---|
| `GET /clients/{id}` | gateway key | OAuthClientInformationFull；不存在404 |
| `/clients` | OAuthClientInformationFull，拒绝 secret/非 none | 同一 metadata；服务端验证/持久化 client_id、redirect_uris、grant_types、response_types |
| `/requests` | `{clientId,redirectUri,codeChallenge,scopes:string[],state?:string,resource}` | `{requestId,expiresAt}`；5分钟一次性随机请求，数据库仅摘要，绑定全部 OAuth 参数 |
| `/requests/inspect` | Bearer **应用会话** + `{requestId}` | `{client:{id,name},scopes,teams,expiresAt}`；只返回已验证客户端和当前账号团队，不返回跳转任意URL |
| `/requests/approve` | Bearer 应用会话 + `{requestId,teamId,approved:boolean}` | `{redirectUri}`，Java 拼接精确注册 redirect URI + code/state 或 access_denied/state；批准只限有效团队成员，owner/admin/editor 才可批准 write |
| `/code` | `{clientId,code,codeVerifier,redirectUri,resource}` | OAuthTokens（access_token、token_type=Bearer、expires_in、refresh_token、scope）；原子一次性 code，5分钟，PKCE SHA256 精确匹配 |
| `/refresh` | `{clientId,refreshToken,scopes?:string[],resource}` | OAuthTokens；同一 grant、资源和团队，scope 不扩张，refresh 轮换、重放撤销整个 grant |
| `/introspect` | Bearer **fm_mcp_ access token** + `{resource,teamId?:string}` | TrustedContext + `authorization:{purpose:'mcp',resource,scopes:string[],clientId}`；session.id 为稳定 grant id，expiresAt 为当前 access expiry；每次检查账号、team、member、grant |
| `/revoke` | `{clientId,token,tokenTypeHint?:string}` | `{success:true}`；已知 refresh/access 均撤销 grant，不存在也成功 |

access 为 `fm_mcp_` + 256位随机值，10分钟；refresh 为 `fm_refresh_` +256位随机值，30天上限。数据库只存摘要。浏览器退出当前应用会话不撤销已明确批准的 MCP grant；重置密码/停用账号必须撤销其 grants。账号/团队停用或成员移除立即拒绝新请求与刷新。不得将 MCP token 用于 `/auth/me` 或团队管理 API。

## 3. scope 与 MCP 会话

- 支持 `flymind:read` 与 `flymind:write`。默认 read+write；write 需要 read。read 允许列举/读图/读标准/请求和读取导出；write 再允许创建、改图、组与回收站。两者均不能管理团队/账号。
- Node CloudControlPlane 识别 `fm_mcp_` 访问专用 introspect，强校验 purpose/resource/scopes；角色权限与 scope 取交集。应用 token 原 introspect 行为不变。
- MCP session 固定 userId/teamId/grantId/dataRootId；每个请求重新验证 Bearer，可接受同一 grant 的刷新 access，拒绝改绑。请求局部凭据通过 AsyncLocalStorage/等价显式上下文传递；不得以全局可变 token 导致并发串号。
- 有界 stateful transport registry、空闲TTL、DELETE释放、重启重新initialize；有效 token 也不能访问另一身份的 session id。未授权响应提供标准 WWW-Authenticate/protected-resource metadata。Origin 校验不阻挡正常顶层 `/authorize` 跨站导航；浏览器 consent 仍走同源 Cookie/CSRF。
- `/#/cloud?authorize=<requestId>` 复用登录后显示客户端、scope、团队选择及批准/拒绝。请求inspect/approve的Node浏览器代理只接受固定两路径，并使用现有应用Cookie与同源写保护；不返回应用token。

## 4. 验收

真实 SDK discovery→DCR→浏览器登录/选团队/批准→PKCE code→MCP guide/create/PNG/edit URL；错误 verifier/redirect/resource、code重放、refresh轮换和重放、scope越权、跨团队/session/账号、停用/移除/密码重置、服务重启后授权事实持久化。契约替身测试先完成，最终必须实际 Java/MySQL/Redis 与双浏览器联调。
