# 让 Agent 连接 FlyMind

## 最简单的用法

把下面的消息发给你正在使用的 Codex 或 WorkBuddy：

> 请帮我安装并使用 FlyMind MCP：https://fly.hui7.fun/mcp。检查已有连接并复用，发起浏览器授权，让我自己登录并选择团队。连接后先读取 get_drawing_guide，根据当前任务分组绘图；后续修改同一张图，不新建副本。

然后你自己在浏览器登录、选择团队并点击授权。工具未出现时按客户端提示重连或新开对话。网页与 Agent 使用同一张图时，从该图的“连接 Agent”面板复制消息，它会自动带上图形身份；本批新界面发布状态见 [U29 验收](validation/onboarding-20261024.md)。

## 手动连接与 Agent 执行规则

以下是无需密钥的详细说明，Agent 不能自动配置客户端时再参考；本文件是仓库文档，不是已部署的同名网页。

1. 远程地址固定为 `https://fly.hui7.fun/mcp`，使用 OAuth，不要求长期 PAT，不复制网站 cookie。先检查已有同地址连接并复用，保留其他客户端配置。
2. Codex 可使用 `codex mcp add flymind --url https://fly.hui7.fun/mcp` 添加，使用 `codex mcp login flymind` 发起浏览器授权。已有同名连接先核对地址，不盲目覆盖。参考 [Codex 官方 MCP 文档](https://developers.openai.com/codex/mcp)。
3. WorkBuddy 使用“设置 → MCP → 添加 MCP Server”，远程传输类型为 `streamableHttp`，填写上述地址，继续客户端发起的浏览器授权。若 Agent 不能操作配置，应给用户明确的手动步骤，不能声称已经安装。参考 [官方用户指南](https://www.codebuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide)及[连接器 OAuth 说明](https://open.workbuddy.cn/docs/connector)。
4. 用户自己在浏览器登录 FlyMind、选择团队并确认。网站登录不会替用户写客户端配置；复制消息也不等于安装成功。必要时重连或新开会话，再检查工具是否可用。本批未承诺两个客户端的真实新授权均已验收。
5. 连接后先读 `get_drawing_guide`。用户给出 `teamId` / `diagramId` 时，授权团队必须匹配；读取该图最新内容和 revision，用 `expectedRevision` 与稳定 `requestId` 修改同一图，保留无关人工编辑/布局，不另建副本。图不存在或团队不符就明确停下。
6. 无图时先确认任务，以 `taskName` 或明确 `workspaceGroupId` 创建第一张图，同任务复用分组。导出沿原 `jobId` 等待，不因超时重建图形。
7. 本地图不会自动上传云端。要让远程 Agent 改本地图，用户先明确导出并导入目标云团队，取得新的真实云图身份，再继续编辑。历史本机包和 npm 分发状态见完整安装文档，不把未正式发布的 npm 包当作首选安装入口。

面板的“我已授权，继续”仅表示用户明确确认，前端不自动证明授权成功；实际权限由 MCP/OAuth 服务逐请求验证。
