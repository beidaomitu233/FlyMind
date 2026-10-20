# Codex 接入 FlyMind

推广的后续方向为[固定HTTPS远程MCP](MCP_UPDATE_STRATEGY.md)：首次配置和登录后，服务端承担日常更新。该服务尚未部署，示例域名不是可用地址；下方仍为当前本地安装方式。源码/安装包升级不会凭空将既有客户切到云端或上传本地图形。

普通用户先按 [安装与使用](INSTALL_AND_USE.md)从 [GitHub Release](https://github.com/beidaomitu233/FlyMind/releases/tag/mcp-v1.0.0) 下载 ZIP、解压并安装 tgz。npm 在线包与 MCP Registry 延期，不使用 npx 请求未发布包。

## 安装后注册

```powershell
flymind setup
flymind doctor
codex mcp add flymind -- flymind mcp
codex mcp list
```

默认 CLI 使用用户持久工作区、原生模式和动态端口，不需手工设置 pilot。FlyMind 本身不要求额外模型 API Key；AI 对话由用户自己的客户端提供。缺资源快速提示 RUNTIME_SETUP_REQUIRED，必须先独立 setup。

## Windows：绝对 Node 入口

本地 tgz 已安装而 npm 尚未上线时，不要让 npx 去请求不存在的版本。先在 PowerShell 找到安装位置：

```powershell
(Get-Command node).Source
npm root -g
```

把结果填入配置，示例路径须换成自己的：

```toml
[mcp_servers.flymind]
command = "C:/Program Files/nodejs/node.exe"
args = ["C:/Users/YourName/AppData/Roaming/npm/node_modules/flymind-drawing-studio/bin/flymind.mjs", "mcp"]
startup_timeout_sec = 180
tool_timeout_sec = 60
```

不要把 `npm root -g` 指向目录误写为 bin 文件，不依赖当前仓库的 tsx。PowerShell `.ps1` shim 被策略禁止时可在终端使用 `.cmd`；无需降低系统策略。

如需独立工作区，在相应 server 表后设置环境变量（路径自行选择）：

```toml
[mcp_servers.flymind.env]
FLYMIND_DATA_DIR = "D:/FlyMindData/workspace-a"
FLYMIND_PORT = "0"
```

网页和各客户端需要相同数据/资源配置，端口以实际返回链接为准。MCP 是 STDIO，工作台 HTTP 地址不是 MCP HTTP 端点；MCP 退出只断连接，不结束共享 Runtime。

## 源码开发兼容入口

源码安装先完成构建与 CLI 资源准备，再注册：

```powershell
npm run build
node bin/flymind.mjs setup
node bin/flymind.mjs doctor
npm run setup:codex
```

`setup:codex` 注册绝对 Node + `bin/flymind.mjs`（无子命令默认 MCP），使用默认原生用户持久目录；不要求全局安装，也不会自动迁移仓库数据。

直接运行 `node server/start.mjs` 仍是开发兼容入口，按 [README 源码启动](../README.md)设置 `FLYMIND_NATIVE_PILOT=1` 和显式隔离 `FLYMIND_DATA_DIR`，不把默认 `data/` 当成可自动迁移对象。

官方配置依据：[Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)。该文档确认 STDIO command/args/env/cwd 与 CLI `--env`；实际包名/CLI 功能以本项目当前实装及 PM 验收为准。

重新加载 MCP 配置或新开会话，先确认 `get_drawing_guide` 可用；注册成功不等于当前对话已发现工具。既有 flymind 表应修改而不是重复追加同名表，不覆盖其他 MCP 配置。不要把本机 npm/Registry token、Runtime 凭据或个人配置提交仓库。

## 切换已有工作区

要继续使用已有图形，先记录原工作台实际的 `FLYMIND_DATA_DIR`、`FLYMIND_PRIVATE_RUNTIME_DIR`、`FLYMIND_RESOURCES_DIR` 和端口，再通过 `codex mcp add flymind --env ... -- <绝对Node> <绝对bin/flymind.mjs> mcp` 更新同名配置。仅改入口而漏填数据目录，会连到默认用户目录，不能据此认为原图丢失。切换不代表迁移旧库，禁止测试性重建/合并用户图形。

保存后在Codex设置→MCP服务器→flymind→Restart，重新读取 `get_drawing_guide`：本次源码质量批次应返回 `standardVersion=1.1`、原生能力及五类支持；再用 `list_diagrams` 核对已有列表。当前聊天的旧进程可能继续返回1.0，CLI配置检查通过不能证明该进程已热更新。此处标准版本不是应用版本，既有GitHub安装包不会因源码改动自动升级。
