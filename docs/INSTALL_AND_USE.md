# FlyMind：让 AI 画图，在网页继续编辑

## 推荐：云端使用，发一条消息给 Agent

打开 [FlyMind 云端工作台](https://fly.hui7.fun/#/cloud)，用绘图账号登录。在 Codex 或 WorkBuddy 中发送：

> 请安装并使用 FlyMind MCP 来画图，地址是 https://fly.hui7.fun/mcp。检查已有连接并复用；通过浏览器发起授权，由我自己登录、选择团队。连接后先读取 get_drawing_guide，再根据当前任务分组绘图；后续修改同一张图，不重复新建。

Agent 会配置连接，或告诉你客户端中最短的操作步骤。你只需在弹出的浏览器里登录并授权；不要把密码、Token 或 Cookie 发给 Agent。工具未出现时重连或新开对话。需要接着编辑网页中的图形时，从该图的“连接 Agent”入口复制带图形身份的消息。

新版工作台提供“创建第一个图形 → 连接 Agent → 同图编辑 → 团队协作”的可跳过引导；发布状态见 [U29 验收](validation/onboarding-20261024.md)。首次只用云端无需安装本机绘图引擎。本地图不会自动上传；先显式导入目标云空间，才能与远程 Agent 修改同图。

手动配置与详细登录步骤见 [Agent 连接指南](AGENT_CONNECT.md)。下文仅为 **历史 Windows 本机包** 的安装说明，不包含当前全部云端功能。

把业务材料变成泳道、流程、架构、脑图和数据流图。AI 负责内容，你在网页调整文字、位置和连线，AI 再读取最新版本修改。图片和源文件由本机 draw.io 引擎生成，FlyMind 本身不要求额外模型 API Key；AI 对话仍由你自己的 Codex 或其他客户端提供。

> **下载方式：本轮通过 [GitHub Release](https://github.com/beidaomitu233/FlyMind/releases/tag/mcp-v1.0.0) 分发 Windows 安装包。npm 在线包和 MCP Registry 暂未发布，请勿用 npx 请求未上线的包。** 应用版本为 1.0.0，下载标签为 `mcp-v1.0.0`。

## 1. 准备环境

支持 **Windows**，推荐 **Node.js 22.12+ 与 npm**；最低要求为 Node.js 20.19+（20 系列）或 22.12+。暂不支持其他操作系统。

```powershell
node --version
npm --version
```

首次安装和准备 draw.io、固定 Chromium 与中文字体需要联网。资源准备成功后绘图与后台导出使用本机固定供应，不依赖系统 Chrome，也不需要克隆仓库或自行构建网页。

## 2. 安装并准备资源

1. 下载 [FlyMind-MCP-1.0.0-Windows.zip](https://github.com/beidaomitu233/FlyMind/releases/download/mcp-v1.0.0/FlyMind-MCP-1.0.0-Windows.zip) 并解压。
2. 在解压目录打开 PowerShell。压缩包保留 `README.md`、`docs/`、许可文件和安装 `.tgz`；不需要克隆源码。
3. 对照 Release 附带的摘要核对安装包，然后安装并准备资源：

```powershell
Get-FileHash ./flymind-drawing-studio-1.0.0.tgz -Algorithm SHA256
npm install -g ./flymind-drawing-studio-1.0.0.tgz
flymind setup
flymind doctor
```

也可单独下载 [安装 tgz](https://github.com/beidaomitu233/FlyMind/releases/download/mcp-v1.0.0/flymind-drawing-studio-1.0.0.tgz)，再执行相同命令。

`setup` 准备固定资源，`doctor` 检查关键资源是否存在、固定 draw.io 版本及字体 SHA256，不是完整供应校验。**先 setup，再 doctor，最后注册 MCP。** MCP 或 studio 缺资源时快速返回 `RUNTIME_SETUP_REQUIRED` 并提示 setup，不在握手前等待下载。

这是本地 npm 安装，**不是完全离线资源包**：原生依赖安装及首次资源下载仍可能联网。PowerShell 若限制 `.ps1` shim，可使用 `npm.cmd`、`flymind.cmd`，不必放宽全局执行策略。

## 3. 连接 AI 客户端

全局安装后注册 Codex：

```powershell
codex mcp add flymind -- flymind mcp
codex mcp list
```

重新加载 MCP 配置或新开对话，实际确认 `get_drawing_guide` 可用。若客户端无法解析 Windows 命令 shim，使用 [Codex 配置](CODEX_SETUP.md)中的绝对 `node + bin/flymind.mjs` 方式。

无子命令时 `flymind` 默认就是 `mcp`。STDIO stdout 只传协议，setup 进度与诊断写 stderr。[Codex 官方接入说明](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)提供配置参考。

其他本地 STDIO 客户端在安装后可使用：

```json
{"mcpServers":{"flymind":{"command":"flymind","args":["mcp"]}}}
```

若客户端不能执行 Windows 命令 shim，按 [Codex 配置](CODEX_SETUP.md)改用绝对 Node + bin 入口。MCP 是 STDIO，本机网页地址不是 MCP HTTP 端点。

## 4. 五种图，直接用自然语言

先对 AI 说“使用 FlyMind，先读取绘图说明”，再提供真实材料，不用写坐标。

| 用途 | 类型 | 可以对 AI 说 |
|---|---|---|
| 多角色交接、阶段、退回 | 泳道图 | 按申请人、审核人、财务画报销流程，保留未通过后的退回 |
| 处理、判断、汇合 | 流程图 | 把订单处理规则画成流程图，每个判断出口写清 |
| 分层、模块、依赖 | 架构图 | 按入口、业务服务、数据层整理系统架构，模块条目简短 |
| 主题与父子关系 | 脑图 | 把需求按用户、功能、运营整理成脑图 |
| 多源汇聚、审核、反馈 | 数据流图 | 画出数据汇聚、处理、生成结果并回传反馈的关系 |

要求 AI 返回图片、编辑链接与 PNG/SVG/JSON/draw.io 文件。来源不明确就标待确认，不猜补业务关系；机器质量检查不能代替你核对业务。

## 5. 网页编辑，再让 AI 修改

```powershell
flymind studio
```

CLI 启动或复用同一工作区的 Runtime 并打开 `/#/native` 网页。端口默认动态分配，使用实际返回链接，不固定猜 5179。网页与 AI 共用同一图形和修订。新工作区自带五个旧版只读示例；要编辑新图，请通过 AI 或侧栏新建，不直接修改示例。

- 侧栏加号新建图，“图形”头部文件夹加号新建分组；拖入或菜单移入后仅在组里显示。
- 双击改字、拖动节点、尺寸和连线后自动保存，等待“已保存”。浅/深主题记住本机偏好，不改图形配色。
- 画布“分组/取消分组”与文件夹归属不同。自动排版和横纵切换先确认；取消不写入。“适合画布”只改视角。
- 网页导出菜单支持 PNG、SVG、JSON 内容数据、工作区文件（完整单图 project）及 draw.io 文件；先保存再后台生成下载。canvas-only 图不提供内容 JSON。MCP 的业务图交付同样包含五种制品，没有用户网页也能生成实际图片。

继续告诉 AI：

> 重新读取这张图的最新修订，把审核拆成初审和复审，保留我手动调整的无关位置和颜色，再返回图片。

修改必须先读最新 revision，带 expectedRevision 与稳定 requestId。冲突先合并，不能覆盖。图形已保存、只是导出失败或超时，应沿用 diagramId/revision/jobId 继续等候或显式重试导出，不能重复创建。

完整字体 SVG 可能超过 MCP 内联预算，此时用返回的真实文件或认证下载，不以旧 PNG、删图或裁剪来源冒充成功。

## 6. 数据在哪，升级会不会丢

默认使用当前 Windows 用户目录：

```text
%LOCALAPPDATA%/FlyMind/data/                    SQLite、历史、制品与导入来源
%LOCALAPPDATA%/FlyMind/runtime/                 实例锁/认证凭据，不要公开
%LOCALAPPDATA%/FlyMind/resources/<供应版本键>/   固定 draw.io/浏览器/字体缓存
```

业务数据不放 npm 安装或 npx 临时目录；升级/卸载包不主动删除数据。`FLYMIND_DATA_DIR`、`FLYMIND_PRIVATE_RUNTIME_DIR`、`FLYMIND_RESOURCES_DIR`、`FLYMIND_PORT` 可覆盖，多个客户端和网页须同配置。CLI 默认原生模式；源码兼容入口仍需显式 pilot/隔离根，不默认迁移仓库 `data/`。

裸 SQLite 不是完整备份，制品/来源/清单也要保留。旧库不自动转换，专用维护恢复有校验与独占要求；公开包不等于后续全部迁移 UI 已完成。

## 7. 故障排查

| 现象 | 处理 |
|---|---|
| npm 在线包不存在 | 当前从 GitHub 下载 `.tgz` 本地安装；npm 在线发布延期，不要用 npx 请求 |
| 找不到 flymind | 检查 npm 全局目录的 PATH，重开终端，或用绝对 node + bin |
| 缺浏览器/字体、下载失败 | 单独 setup 后 doctor，检查网络；不改资源 SHA 或随意换系统 Chrome |
| RUNTIME_SETUP_REQUIRED / MCP 启动失败 | 先独立运行 setup，再 doctor 后重新连接；不在 MCP 握手中下载 |
| 端口/工作区不符 | 使用实际链接，核对覆盖变量；不结束未知进程、复制凭据或盲改数据库 |
| 保存冲突 | 保留草稿，读远端最新修订再合并；不自动覆盖或复活已删除 ID |
| 删除保存被拒 | 撤销后 Ctrl+Delete 删除节点及关联线，再保存；不删数据库排错 |

## 8. 卸载，保留业务数据

```powershell
npm uninstall -g flymind-drawing-studio
```

卸载不主动删除上述数据/缓存，也不任意结束已运行共享 Runtime。移除客户端中仅 `flymind` 的 MCP 配置，不影响其他工具。更新源码/包后已运行后台不自动换版本，需完成任务后正常关闭自己的旧实例再启动。只有明确决定清数据时才另行操作，并先做完整备份。

主项目使用 [MIT](../LICENSE)，draw.io、字体、浏览器和依赖保留各自许可，见 [第三方声明](../THIRD_PARTY_NOTICES.md)。MCP Registry 只提供发现元数据，不能替你安装 Node，也不表示已上架插件商店。

## 验证记录

| 环境 / 项目 | 已完成结果 |
|---|---|
| Windows、Node.js 20.19.6、npm 10.8.2 | 独立临时目录使用 `--omit=dev` 安装，168 包、约 48 秒 |
| 固定资源 | 真实网络 setup 与 doctor 通过 |
| 回归与构建 | npm test 309 项及 CLI 定向 4 项通过，build 通过 |
| 五类真实 SDK | 18 工具发现、规则读取；五类图真实 PNG 与五种制品、AI 修改、幂等、分组和重连通过 |
| 网页编辑 | 独立安装页面实际改字并自动保存、下载 PNG 通过 |
| 复装与交替修改 | 复装同版本安装包后保留网页 r3；MCP 读到网页修改并继续保存为 r4、返回真实 PNG |
| Node.js 22.12+ | 推荐版本，尚未记录独立安装验证结果 |
| npm / MCP Registry | 延期；Registry 元数据已通过官方 validate，未发布 |

## 后续 npm 在线分发

维护者完成账号和正式发布后，才可使用在线包安装；届时会更新本页。当前请始终使用上述 GitHub 下载流程。
