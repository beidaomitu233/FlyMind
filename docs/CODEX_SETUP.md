# 连接 Codex

FlyMind 是本地 MCP 服务。Codex 负责理解业务并编写图形 JSON；MCP 在本机保存数据并渲染图片；编辑器读写相同文件。不需要 OpenAI API Key。

## 一次性配置

在项目根目录运行：

```powershell
npm ci
npm run build
npm run setup:codex
```

脚本定位本机 Codex CLI，然后用 `codex mcp add flymind -- <node绝对路径> <server/start.mjs绝对路径>` 注册。注册只添加 flymind，不覆盖其他 MCP 配置。`codex mcp list` 可查看配置。

重新加载 Codex 的 MCP 配置，必要时重新打开会话。当前已经运行的会话未必会动态加载新增工具；没有看到 flymind 工具时不能把“已注册”当成“当前对话可用”。

官方配置说明：[Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)。官方 SDK：[MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x)。

## 手动配置

在 Codex 设置添加 STDIO MCP，或向 `~/.codex/config.toml` 添加以下独立配置。把路径替换为自己的安装路径，Windows 建议使用正斜线：

```toml
[mcp_servers.flymind]
command = "C:/nvm4w/nodejs/node.exe"
args = ["D:/AIBuilder/PM/flyMind/server/start.mjs"]
cwd = "D:/AIBuilder/PM/flyMind"
startup_timeout_sec = 30
tool_timeout_sec = 60
```

从插件形式安装时，可用项目的 `plugin.json`、`mcp.json` 和 `skills/draw-with-flymind/SKILL.md`。这组文件是本地插件包；不代表已发布到公共插件目录。

## 发起绘图

可以向 Codex 说：

> 使用 FlyMind，读取绘图说明，按以下材料绘制一张泳道图。返回图片、SVG/JSON 和编辑链接。保留每个判断的出口和回流。

后续修改：

> 读取图形 ID xxx 的最新版本，只把售前咨询拆成两个步骤，保留我在网页调整过的颜色和位置，修改后重新给我图片。

工具链是 `get_drawing_guide → create_diagram → get_diagram → patch_diagram → export_diagram`。创建和修改工具已经直接返回图片，最后一步可用于单独重新导出。

## 运行服务

开发：`npm run dev` 启动 5178 网页和 5179 共享服务。构建后 `npm start` 在 5179 提供完整应用。

MCP 首次调用会检查共享服务；未启动时自动在后台启动 5179 本机服务，打开返回的 editorUrl 即可编辑。后台启动隐藏窗口。若配置 `FLYMIND_AUTO_WEB=0`，则禁用自动启动，需要手动运行应用。

数据默认在项目的 data/ 目录。`FLYMIND_DATA_DIR` 可指定其他持久化目录；MCP 和网页服务必须使用同一个路径。`FLYMIND_PORT` 默认 5179，`FLYMIND_EDITOR_URL` 可把编辑链接指向已运行的 5178 开发页面。当前只监听 127.0.0.1。

本地数据、图片、日志、密钥和 node_modules 不推送到 GitHub。复制项目时应备份 data/；不要清理它以解决服务问题。

## 常见问题

| 现象 | 处理 |
|---|---|
| Codex 找不到 flymind 工具 | 查看 mcp list；重新加载 MCP 或开启新会话；检查 command/args 的绝对路径 |
| 服务启动失败 | 先 npm ci、npm run build；检查 Node.js 20.19+；启动 npm start 查看错误 |
| 图片中文字体缺失 | 安装系统中文字体；SVG 使用 Microsoft YaHei/Segoe UI；PNG 通过 Sharp 读取系统字体 |
| 网页显示共享服务未连接 | 启动 npm run dev；已有 Vite 进程时可单独 npm start；点击重试同步 |
| AI 修改遇到版本冲突 | get_diagram 读取最新数据，再合并用户修改并提交新 expectedRevision |
| 用户网页修改看不到 | 等待“已保存”，再读取最新版本；不能依赖上次对话里的旧 JSON |
| 图形太拥挤 | 调整 order/分组，增加节点尺寸或手动位置；不要删掉真实业务关系 |

MCP STDIO 的标准输出只用于协议；诊断日志写到标准错误。后续功能应以外围适配器接入，保持 src/drawing/core 独立于 AI 平台、项目管理和认证。
