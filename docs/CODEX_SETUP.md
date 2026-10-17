# 连接 Codex：FlyMind 1.0.0 原生模式

FlyMind 是本机 STDIO MCP。AI 编写纯业务 content，Runtime 与 draw.io 工作台共用 SQLite 和真实后台渲染，不需要 OpenAI API Key。当前新版需显式 pilot、独立数据目录，HTTP 5179 不是 MCP 端点。

## 先准备本机资源

在项目根目录执行：

```powershell
npm ci
npm run setup:runtime
npm run check:runtime
npm run build
```

固定供应包含 draw.io 31.5.3、Chromium headless shell 151 与中文字体；首次安装需联网。目录与端口说明见 [README](../README.md)。

## 配置原生 MCP

把绝对路径换成自己的安装位置与持久工作区。在 `~/.codex/config.toml` 的现有 `flymind` 配置中修改，不要重复添加同名表：

```toml
[mcp_servers.flymind]
command = "C:/Program Files/nodejs/node.exe"
args = ["D:/Apps/FlyMind/server/start.mjs"]
cwd = "D:/Apps/FlyMind"
startup_timeout_sec = 30
tool_timeout_sec = 60

[mcp_servers.flymind.env]
FLYMIND_NATIVE_PILOT = "1"
FLYMIND_DATA_DIR = "D:/FlyMindData/native-v1"
FLYMIND_PORT = "5179"
```

Codex 的 STDIO `command/args/cwd/env` 配置和 CLI `--env` 用法见 [OpenAI 官方 MCP 文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)。也可使用 CLI 注册（替换实际路径）：

```powershell
codex mcp add flymind --env FLYMIND_NATIVE_PILOT=1 --env FLYMIND_DATA_DIR=D:/FlyMindData/native-v1 --env FLYMIND_PORT=5179 -- node D:/Apps/FlyMind/server/start.mjs
codex mcp list
```

`npm run setup:codex` 仍可定位 CLI 并注册 Node/入口，但脚本不写上述 env；若只执行该脚本，未显式传入环境变量时会运行旧 MCP 分支。现有本地插件 `plugin.json/mcp.json` 同样不能替代原生 env 配置，不代表已上架公共目录。

重新加载 MCP 配置或新开会话。注册完成不等于当前会话已经发现工具；已运行进程也不会自动切到新版源码。不要为了排查而删除数据或复制另一工作区的实例凭据。

## 运行与查看

原生 MCP 首次实际调用按需启动或连接**同数据根** Runtime。MCP 退出只 detach，后台实例继续服务；Windows 自有渲染浏览器静默启动。网页打开 `http://127.0.0.1:5179/#/native`，或工具返回的 `editorUrl`。

若自行启动网页，另一个 PowerShell 使用完全相同配置：

```powershell
$env:FLYMIND_NATIVE_PILOT = '1'
$env:FLYMIND_DATA_DIR = 'D:/FlyMindData/native-v1'
$env:FLYMIND_PORT = '5179'
npm start
```

已有同根后台时不要重复启动；使用已返回的网页地址。若端口属于其他工作区或旧服务，请选择空闲端口并同时修改两端配置，不结束未知进程。`FLYMIND_AUTO_WEB=0` 是旧分支选项，不能让原生 MCP 脱离 Runtime 工作。

`/#/` 仍为旧 Studio，不是本次 draw.io 页面；v3 禁止旧写入口降级保存。原生必须使用默认仓库 `data/` 之外的显式根；不自动迁移已有 v2 或更改用户正在运行的数据。

## 发起绘图

> 使用 FlyMind，先读取绘图规则，再按以下材料创建泳道图，返回真实图片、文件与编辑链接；保留判断出口和回流。

工具链：`get_drawing_guide → create_diagram → get_diagram → patch_diagram`。创建与修改提供稳定 `requestId`，修改携带最新 `expectedRevision`，同请求重试保持全部参数一致。内容不写坐标。五类已启用的业务类型及配置范围，以每次返回的能力表为准；当前配置公开显式 `relayout:true` 与可选 `orientation`，不承诺旧坐标样式字段全部适用。

收到 `saved=true` 但导出失败/等待超时，保留图形/修订/任务身份：用 `export_diagram(jobId=...)` 继续等候，失败任务用 `retryJobId` 显式重试，不重新创建图形。大字体 SVG 可能超过 STDIO 8 MiB 安全预算，请使用返回的真实文件路径或认证下载，不修改 SDK 默认预算冒充内联成功。

## 排查

| 现象 | 检查 |
|---|---|
| 看见旧画布 | 确认 pilot env、`/#/native`、构建和 Runtime 版本；旧进程不会自动重载 |
| 原生启动失败 | 检查独立根、空闲端口、固定资源；查看本机 stderr，不能把错误写入 STDIO stdout |
| 字体/浏览器缺失 | `npm run setup:runtime`、`npm run check:runtime`；不依赖系统字体或任意 Chrome |
| 版本或工作区冲突 | 读取最新 revision；换库身份不自动跟随，不盲目重建或覆盖 |
| 网页修改 AI 看不到 | 等待已保存后重新 get_diagram，不能复用旧对话 JSON |

本地数据、导出、原始导入文件、日志及实例凭据不推送仓库。完整备份与离线维护恢复见 [备份恢复验证](validation/native-backup-restore.md)，裸 SQLite 不是完整备份。发布 1.0.0 不代表后续路线或默认迁移门槛已全部完成。
