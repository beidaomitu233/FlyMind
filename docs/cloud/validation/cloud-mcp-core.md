# C02-C 固定团队云端 MCP 业务适配

日期：2026-10-19。状态：待 PM 验收。仅源码工厂与隔离测试，不是已发布远程 MCP；未实现 OAuth，也没有在生产 cloud HTTP 入口挂载 `/mcp`。

## 接口与作用域

- `server/cloud/mcp-connection.ts`：`createCloudMcpConnection(CloudMcpOptions)`，返回固定 `connection`、只读 `binding`、`checkHealth/close/editorURL`。不调用本机 Runtime 启动器，不生成本机数据根。
- `server/cloud/mcp.ts`：`createCloudMcpSession(options)` 返回 `binding`、`handleRequest(req,res,body?)` 和 `close()`。`binding` 仅含 `userId/sessionId/teamId/dataRootId`。每个独立实例使用独立 SDK StreamableHTTP transport 与 MCP server。
- options 中的 cloudOrigin、teamId、token 与 identity 由可信宿主提供，初始化先调用真实身份提供者授权，再经团队 HTTP health 绑定工作区。后续身份、应用会话、团队、工作区改变即拒绝，不自动改绑。不缓存授权结果；角色降级由每次 Java 与团队 API 权限检查即时生效。
- `handleRequest` 固定 Bearer，精确 Host/Origin、拒绝跨站请求。所有 MCP HTTP 请求先重新授权并通过团队 health，包括不访问图形 API 的 guide/规则资源。业务工具与制品继续通过 `/cloud-api/teams/<固定team>/studio-api/native/...`，复用既有 CAS、actor requestId、质量校验和共享导出池。
- adapter 只接受绑定团队内的 native/health 相对资源，拒绝绝对 URL、越界路径、其他团队、编码分隔符与身份 header 覆盖；fetch 固定 `redirect:'error'`，无凭据 URL/日志输出。token 属性不参与连接 JSON 序列化。close 只释放本会话，不关闭 cloud HTTP/renderer。
- `createNativeMcpServer` 只增加可选 `editorURL(diagramId,connection)`；local 默认 `/#/native?diagram=...` 保持不变。云端编辑链接为 `https://origin/#/cloud?team=<id>&diagram=<id>`，无 token。测试允许显式回环 HTTP，非回环要求 HTTPS。

## 实际验证

```powershell
& 'C:/nvm4w/nodejs/node.exe' --import tsx --test tests/cloud-mcp.test.ts tests/native-mcp.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.server.json
```

最终 **14/14 通过**（云端2项、原本机 MCP12项），约13.9秒；server tsc 通过。使用与现有 SQLite ABI 匹配的 Node20.19.6；测试进程经批准执行，没有重装依赖。

真实测试宿主只在独立回环 HTTP 上组合：Java introspect HTTP stub → `CloudControlPlane` → `createCloudHTTP` → 既有 Native 服务/SQLite/`NativeDrawioRenderer` → SDK **1.32.1** Streamable HTTP Client。没有用 InMemoryTransport 或假 PNG 代替本条链路。

1. Guide 调用新增真实 Java introspection，并经过团队 health。
2. 创建合成流程图 r1，原生后台输出 PNG；MCP image 签名正确。
3. 同会话 get r1 → 实质 update_node 文案 → r2，同一图形/工作区，原生 r2 导出成功；读取 MCP PNG resource，核验签名与 SHA。
4. 所有制品 URL 限定 team-a。team-b 独有图通过 team-a MCP 读取失败；用 team-b 路径读取 team-a 制品返回404。
5. 错误会话凭据401；控制面撤权后原 HTTP 请求401，SDK guide 与 resource 均拒绝。
6. 单元测试验证跨团队/绝对路径/凭据覆盖、user/session/team/root 改绑拒绝，关闭后不能继续访问；绑定/连接 JSON 不含测试 token。
7. 临时团队数据根最终删除，HTTP/SDK/原生 renderer 正常关闭。未启动本机 Runtime，未访问用户数据库。

证据：`output/playwright/cloud-mcp/report.json`（仅非敏感 binding、修订、PNG字节/SHA、状态码、授权次数与耗时）。测试合成数据与原生输出在临时根，结束清理。首次运行13/14仅因断言错误地要求 SDK error message 包含数字401；SDK实际正文为 LOGIN_REQUIRED，随后补直接 HTTP401与SDK错误码断言，产品保护未放宽。

## 后续门槛

- 测试身份上游是符合 Java 契约的真实 HTTP stub，尚非 Java SQL 联调；不声称完成真实账号端到端登录。
- 应用 sessionToken 不是最终 OAuth MCP access token。本工厂不替代 audience/scope、PKCE、授权码/refresh/revocation、受保护资源元数据等 OAuth 接线；未提供公开安装说明或免验开发 token 路由。
- 工厂目前为每个绑定会话构造 transport；生产 OAuth 宿主仍需有界会话 registry、过期回收、限流和正确路由。当前没有公网入口，也没有跨进程会话恢复。
- 本批不实现多人 room、pending 重基与统一协同事务。既有云端 revision/CAS 是共享业务服务基础，不代表实时协同已经完成。

请求 PM 验收本切片的固定授权团队 facade、SDK真实业务闭环与 local 默认兼容范围。
