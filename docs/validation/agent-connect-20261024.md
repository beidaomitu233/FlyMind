# U29 Agent 连接入口（待 PM 验收）

## 交付与接口

- `FlyMindAgentConnect.vue`：`open`、可选 `appearance`（默认 light）、可选 `context:{diagramId?,title?,teamId?}`；发出 `close` / `confirmed`。后者只由用户点击“我已授权，继续”触发，无自动连接验证含义。
- `agent-connect.ts`：独立纯内容模型，生成 Codex / WorkBuddy 的单条安装消息，默认固定 `https://fly.hui7.fun/mcp` + OAuth；不提供 PAT、cookie、密码/token 输入，不包含 npm 在线包安装或用户环境绝对路径。
- 当前云图需有效 `teamId` + `diagramId`，消息要求授权团队匹配、先读取最新 revision，以 `expectedRevision` / 稳定 `requestId` 修改原图，保留无关编辑与布局、不新建副本。仅本地图或身份不完整时，先提示用户显式导入；无图时按任务分组创建第一图。业务标题只显示，不插入 Agent 指令，避免把标题当作额外指令。
- 文档组件新增 `start-tour` / `connect-agent`，按钮先发 `close` 再发相应事件；MCP 主章变为“连接 AI”，JSON/CLI/历史本机包放折叠的高级章节。保留本地授权与云端同步边界、五类图/五制品、前后台独立密码说明。
- 无密钥指南在仓库 `docs/AGENT_CONNECT.md`，未承诺线上已部署同名网页。安装消息本身可独立理解，不依赖 MCP 已安装或这个文件在线可访问。

## 官方依据（2026-10-24 实读）

- [Codex 官方 MCP 文档](https://developers.openai.com/codex/mcp)重定向到 ChatGPT Learn，确认 `codex mcp add … --url`、`codex mcp login`。主消息将命令交给 Agent，用户无需先理解配置语法。
- [WorkBuddy 官方用户指南](https://www.codebuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide)：设置 → MCP → 添加服务器，继续 OAuth 授权。
- [WorkBuddy 连接器官方说明](https://open.workbuddy.cn/docs/connector)：远程 `streamableHttp`，OAuth 2.1 + PKCE、自动凭据管理与受支持的回环回退。未将连接器开发者后台或自填 token 作为本产品主入口。

## 验证与边界

- 定向命令：`C:/nvm4w/nodejs/node.exe --import tsx --test tests/agent-connect.test.ts tests/flymind-documentation.test.ts`，8/8 通过。覆盖两客户端、精确同图约束、本地/错误身份不误定位、首图任务分组、折叠高级内容及既有文档事实。
- 新组件包含深浅配色、窄屏 CSS、Escape/Tab 焦点约束与关闭后恢复焦点；默认浅色使用 ui tokens，并提供 Iris/Slate fallback。未运行浏览器，不将响应式样式实现称为实际窄屏/剪贴板验收。
- 未运行生产请求、真实客户端新授权、SSH、提交/推送或版本变更。复制消息不等于安装成功；浏览器登录不等于网站写入客户端配置；用户确认不等于服务端验证。实际接线、类型/构建和页面验收由 PM / application 集中完成。
