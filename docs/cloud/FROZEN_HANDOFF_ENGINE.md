# 引擎代理：协作版本冻结交接

日期：2026-10-20。用户切换优先级至绘图质量；本记录仅交接已落盘状态，不代表 OAuth/协作版本整体验收。原代理保留，未提交、推送或修改版本。

## 当前 OAuth 切片

- 新增 `server/cloud/oauth-provider.ts`：SDK1.32.1 OAuth provider，固定 Java 内部 origin/gateway key；DCR、授权请求、Java 原子 PKCE/code、refresh、revoke 与 introspect。
- 新增 `server/cloud/oauth-mcp.ts`：有界 stateful MCP registry、TTL/DELETE、固定 user/team/grant/root、AsyncLocalStorage 请求局部 token，允许同 grant 刷新而不改绑。
- 已改 `server/cloud/identity.ts`、`http.ts`、`start.ts`、`mcp-connection.ts`、`mcp.ts`：严格 authorization/scope 与角色交集、专用 MCP introspect、标准 discovery/router 与 `/mcp` 装配、固定 cookie consent 两路径、静态 dist SPA。源开发入口现在要求 `FLYMIND_GATEWAY_KEY`；无 gateway 的工厂调用不挂 OAuth。本机 Runtime 入口未改。
- 新增 `tests/cloud-oauth.test.ts`。原 `server/mcp-native/server.ts` 的可选 editorURL 扩展来自前一 C02-C 切片，本机默认编辑链接不变。
- 当前保留的实际修复：read scope 可请求 `/exports/snapshot`；空闲 SSE GET 不占实际工作 active 计数，避免 TTL 永不过期。

## 最后验证事实

1. 最后命令：`C:/nvm4w/nodejs/node.exe --import tsx --test tests/cloud-oauth.test.ts`，**2/2通过**，约15秒；包含真实 SDK discovery/DCR/PKCE、原生 PNG、refresh 同会话、read scope 导出与拒写、并发 grant 隔离、会话错绑/撤权、capacity/DELETE/TTL、consent CSRF 和 SPA。
2. 最后 `node node_modules/typescript/bin/tsc -p tsconfig.server.json` 通过。
3. 此前合并 `cloud-oauth + cloud-mcp + native-mcp` 为15/16；唯一 TTL 新用例暴露 SSE GET 长驻问题，修复后只重跑 OAuth2项通过；**未再声称16项联合重跑通过**。C02-C 独立云MCP+本机MCP此前14/14通过。
4. 证据 `output/playwright/cloud-oauth/report.json`：SDK1.32.1、真实 PNG、revision1、refreshSameSession、scope/session/revocation状态；不含 token/secret。测试上游是遵循 Java 契约的真实 HTTP stub，不是真实 Java SQL 联调。
5. 初次 OAuth 测试 setup 错用空登录输入，按产品校验被拒；当时仅精确清理本次测试 PID2772/20588。后续测试均正常退出并清理临时根/HTTP/renderer。

## 进程与未完成项

- 2026-10-20 冻结核对：Win32_Process 精确匹配本代理 `cloud-oauth.test.ts`、`cloud-mcp.test.ts`、`cloud-http.test.ts` 测试命令，**无匹配运行进程**。最后 exec 会话已 exit0；无本代理仍运行服务/测试/浏览器。未操作用户5189 Runtime。
- 尚未完成 PM 独立 OAuth验收、真实 Java/MySQL/Redis OAuth 联调、浏览器真实批准完整链路、重启持久授权事实及完整安全集成回归；不得宣称远程 MCP 已发布。
- C03 的 merge/protocol-patch/协同保存由 PM 实现，不属本 OAuth 切片；未接后续 collab HTTP/room。真实多人完整产品链路尚未完成。
- 尚未补独立 OAuth正式验证报告；本记录作为暂停点。已有 C02-C 报告 `docs/cloud/validation/cloud-mcp-core.md` 是前一无公开 `/mcp` 切片的历史事实，不能覆盖本次新装配状态。
- 未运行全套构建/全量测试，不再新增实现或诊断。由 PM 决定协作分支保存与后续恢复，代理等待绘图质量派单。
