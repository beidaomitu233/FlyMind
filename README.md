# FlyMind Studio 1.0.0

本地 AI 绘图与网页编辑工作台。AI 编写纯业务内容，FlyMind 通过 MCP 保存并使用固定 draw.io 引擎生成图片；用户在原工作台界面继续编辑，AI 再读取最新修订修改。FlyMind 本身不要求额外模型 API Key；AI 对话由用户自己的 Codex 或其他客户端提供。

本次发布：**v1.0.0 · 2026-10-18**。draw.io 版保留原产品侧栏、标题、属性、新建与导出交互，新增明暗主题、画布分组、显式自动排版和横纵切换。源码兼容入口的原生模式仍需显式开启并使用独立数据目录；CLI 默认使用用户持久目录。发布版本号不代表 D07/D08/G2 全部路线已验收。

[文档中心](docs/README.md) · [实施计划与验收边界](docs/IMPLEMENTATION_PLAN.md) · [内容标准](docs/DRAWING_STANDARD.md) · [Codex 配置](docs/CODEX_SETUP.md) · [变更记录](CHANGELOG.md)

## 安装与使用

**[下载 Windows 安装包](https://github.com/beidaomitu233/FlyMind/releases/download/mcp-v1.0.0/FlyMind-MCP-1.0.0-Windows.zip)** · [GitHub Release](https://github.com/beidaomitu233/FlyMind/releases/tag/mcp-v1.0.0) · **[安装与使用](docs/INSTALL_AND_USE.md)**

下载 ZIP → 解压 → `npm install -g ./flymind-drawing-studio-1.0.0.tgz` → `flymind setup` → `flymind doctor` → 注册 Codex。无需 clone 或构建源码；首次安装依赖与资源准备需要联网。

本轮下载标签为 **mcp-v1.0.0**，应用版本仍为 **1.0.0**，保留原 `v1.0.0` 标签。**npm 在线包和 MCP Registry 暂未发布**，请勿用 npx 请求未上线包。维护者见 [发布流程](docs/PUBLISHING.md)。主项目 [MIT](LICENSE)，第三方资源和依赖保留各自许可；目前支持 Windows。

## 源码安装：启动当前 draw.io 工作台

建议使用 Windows 与 Node.js 22.12+；项目最低要求为 Node.js 20.19+（20 系列）或 22.12+。在克隆后的项目根目录执行：

```powershell
npm ci
npm run setup:runtime
npm run check:runtime
npm run build

$env:FLYMIND_NATIVE_PILOT = '1'
$env:FLYMIND_DATA_DIR = Join-Path $env:LOCALAPPDATA 'FlyMind/workspaces/native-v1'
$env:FLYMIND_PORT = '5179'
npm start
```

打开 **http://127.0.0.1:5179/#/native**。新目录第一次启动显示五个旧版只读示例，可通过 AI 或侧栏加号创建新的可编辑图形。以上命令不会复制或迁移已有 `data/`，请勿将原生数据目录指向仓库 `data/` 或其子目录；程序会在初始化前拒绝该路径。

`setup:runtime` 下载并校验固定 draw.io 31.5.3、Chromium headless shell 151（Playwright 1.62.1 对应 revision 1234）及 Noto Sans CJK SC 字体，需首次联网，资源放在本项目 `resources/`。不依赖系统 Chrome 或上级项目资源。供应验证通过后，编辑与后台导出使用本机资源。

若 5179 已被其他实例占用，不要结束未知进程或误连旧工作区；选择空闲 `FLYMIND_PORT` 并使用对应地址。当前页面与 MCP 必须使用同一个数据根和端口。**仅更新仓库/构建不会重启已运行的旧服务**，请在合适时机正常关闭自己启动的旧实例后再启动新版；不要为升级删除数据。

### 新旧入口区别

| 入口 / 模式 | 含义 |
|---|---|
| `/#/native` 且 `FLYMIND_NATIVE_PILOT=1` | 本次 draw.io 新版工作台，完整 v3 原生文档与后台导出 |
| `/#/` | 保留的旧 Studio 页面；不是 draw.io 新版入口，不能用它编辑原生 v3 记录 |
| 未设置 `FLYMIND_NATIVE_PILOT=1` | 保持旧运行分支；默认数据根仍为仓库 `data/`，不会自动切为新引擎 |
| `/#/legacy` | 更早应用保留入口，不是当前绘图工作台 |

不要在同一原生工作区混用旧页面或旧 MCP 写入；旧写入口遇 v3 会拒绝，避免丢失 XML。旧 v2 记录在新版列表明确只读/未迁移，不自动转换。

### 开发模式

沿用同样的原生环境变量，保持后端端口 **5179**，运行 `npm run dev`，打开 http://127.0.0.1:5178/#/native。脚本提供 5178 Vite 页面并启动或复用 5179 服务；Vite 代理当前固定指向 5179，复用前请确认该服务也是新版、同数据根原生实例。日常使用优先上面的同源 `npm start` 方式。

## 连接 MCP

MCP 使用 STDIO；HTTP 端口是工作台与制品服务，不是 HTTP MCP 地址。npm/tgz 用户先按 [安装与使用](docs/INSTALL_AND_USE.md) 准备资源并注册 CLI；以下源码兼容入口需显式配置原生环境变量。源码构建后先执行 `node bin/flymind.mjs setup` 与 `doctor`，再运行 `npm run setup:codex`，会注册 CLI 默认原生用户目录入口；以下 `server/start.mjs` 配置仅用于显式 pilot 的兼容启动。

其他支持本地 STDIO 的客户端可使用以下配置，替换为自己的绝对路径，并与网页使用同一目录/端口：

```json
{
  "mcpServers": {
    "flymind": {
      "command": "node",
      "args": ["D:/Apps/FlyMind/server/start.mjs"],
      "env": {
        "FLYMIND_NATIVE_PILOT": "1",
        "FLYMIND_DATA_DIR": "D:/FlyMindData/native-v1",
        "FLYMIND_PORT": "5179"
      }
    }
  }
}
```

原生 MCP 按需连接或启动同根本机 Runtime；MCP 客户端退出只断开连接，不关闭共享服务。工作区身份、实例凭据与版本能力握手防止误连，网页会通过同源会话认证访问数据。不得公开本机凭据或把编辑链接当成跨设备分享链接。

| 环境变量 | 当前作用 |
|---|---|
| `FLYMIND_NATIVE_PILOT` | 只有值 `1` 开启原生分支，默认关闭 |
| `FLYMIND_DATA_DIR` | 原生模式必须显式提供，且在仓库默认 `data/` 之外 |
| `FLYMIND_PORT` | Runtime 端口，默认 `5179` |
| `FLYMIND_EDITOR_URL` | 仅旧 MCP 分支的链接选项；当前原生 MCP 链接使用握手 Runtime 的地址，开发页可手动打开 5178 |
| `FLYMIND_PRIVATE_RUNTIME_DIR` | 可选实例锁/凭据目录，默认由系统用户目录管理，与业务数据分开 |
| `FLYMIND_AUTO_WEB` | 仅旧 MCP 分支的自动启动选项；不能用它关闭原生 MCP 所需的 Runtime |

## AI 绘图与交付

五类业务 `kind`：`swimlane` 泳道、`flowchart` 流程、`architecture` 架构、`mindmap` 脑图、`dataflow` 数据流卡片。先调用 `get_drawing_guide` 获取正式内容标准和当前能力表，再创建/修改。数据流卡片不等同严格 DFD，不宣称覆盖全部 UML/BPMN。

流程：`get_drawing_guide → create_diagram → get_diagram → patch_diagram`。原工具名称保持 18 个，包含内容校验、完整更新、配置读取/修改、导出、工作区分组与回收站操作；实际输入以工具发现 schema 为准。

- 内容层提供 `schemaVersion:1`、稳定 `id`、`title/kind/nodes/edges/lanes/phases/groups`，不写坐标或渲染字段。
- 创建、内容更新、增量修改、渲染配置和导出使用稳定 `requestId`。不确定是否提交时沿用相同 ID 与全部参数重试，不重新创建；修改还必须携带最新 `expectedRevision`。
- AI 新建需质量合格；修改历史人工草稿不能新增或加重错误/警告。默认结构修改不能只加注释交差，明确批注使用 `editIntent=annotation`。网页人工草稿可保留真实业务缺口。
- `get_diagram` 默认返回纯内容和修订；尺寸只有真实渲染后才提供。创建/修改/预览/导出读取同一不可变快照的 PNG、SVG、draw.io、纯内容 JSON、完整 v3 project JSON 五制品。
- `files` 为 Runtime 验证的本机绝对路径，`urls` 为认证下载地址，`resources` 为 `flymind://exports/{id}/{revision}/{exportId}/{format}`。完整字体 SVG 可能较大；STDIO 固定 8 MiB 安全预算，超大内联返回明确错误，改用本机文件或认证下载，不能裁剪源图冒充成功。
- 若返回 `saved=true` 但导出失败/超时，保留 `diagramId/revision/jobId`。`export_diagram` 的 `jobId` 继续等待同一任务，`retryJobId` 显式重试失败快照；不重复创建图形、不把旧 PNG 当新修订结果。
- 网络失败/401 后原生 MCP 下一次同键请求可重连同工作区；首次不盲目重放写操作。修订冲突、已删除与换工作区身份会明确拒绝。

渲染配置本次公开范围为 `rendering:{relayout:true,orientation?:"vertical"|"horizontal"}`；自动排版仅提交 `relayout:true` 保持当前方向。其他配置字段明确拒绝，不宣称旧版所有坐标/样式配置均已接入。含原生人工组合等不能安全全排的文档可能明确拒绝，保留原图。

## 网页使用

- 保留原工作台产品结构：侧栏搜索、排序、分组、回收站，标题/保存状态，按需业务属性，新建与格式导出菜单；画布底层换为 draw.io。
- 图形列表头文件夹加号创建分组，成功自动展开；拖入或菜单移入，归组后仅在组内出现。画布“分组/取消分组”是独立的原生视觉组合，不改变业务归属。
- 双击图元改字，原生拖动/缩放/连接后自动保存。显式自动排版与适合画布分开，横纵切换先应用内确认。显式内容/排版提交建立撤销边界，不承诺跨该边界原生撤销。
- 点击列表立即选中并更新标题/地址；固定画布区域显示轻量加载，候选就绪后切换，过时请求不激活。主题开关为浅色/深色，浏览器记忆偏好；编辑环境背景跟随主题，图元业务配色与导出不变。
- 格式菜单点击 PNG/SVG/JSON/project/draw.io 后先提交并保存当前编辑，再后台生成和下载。后台无用户页面也可导出，Windows 自有渲染浏览器静默启动。
- 普通 Delete 若留下悬空业务线会拒绝保存并保留草稿；撤销后用 Ctrl+Delete 删除节点及关联线。脑图专用删除分支入口有明确确认。

当前业务文件导入支持纯 content JSON 与完整单图 v2/v3 project JSON，新 ID/时间且不继承来源组织、历史和回执。v2 先经过无损迁移，不丢手工覆盖后重编译。单页 draw.io/canvas-only 导入和显式映射仍未公开启用；压缩、多页与损坏业务元数据不静默降级。JSON/FMD/Markdown 旧入口能力不等于新版全部支持。

## 数据、迁移与备份

原生 v3 在同一 SQLite `diagrams.document` 保存业务内容与完整 draw.io XML，沿用图形 ID、修订、历史、分组、回收站与永久删除标记。编辑草稿使用带工作区身份/会话守卫的 IndexedDB；冲突不覆盖远端，旧 localStorage 不自动回放到原生库。

迁移预览/显式提交及完整备份恢复基础设施已实现并通过指定范围验证，**不是“迁移尚未实施”，也不是启动即自动迁移用户库**。旧源转换遇不能无损表达的内容会明确阻断。[备份恢复说明](docs/validation/native-backup-restore.md)包含在线 SQLite、成功制品、导入来源、供应摘要和校验清单；裸 `.sqlite` 不代表完整可恢复备份。恢复入口目前为关闭 Runtime 后的独占维护 CLI，先校验/计划，目标有新写入会拒绝，恢复旋转工作区身份。维护 UI 与最终默认切换仍属后续范围。

默认 `data/`、独立工作区、artifacts、备份、原文件、资源缓存、凭据和日志需自行保管，不提交仓库。换机须另行备份完整工作区与供应资源。不要删除数据库或运行中的 WAL/SHM 来排查问题。

## 验证、排查与发布边界

```powershell
npm test
npm run build
npm run check:runtime
```

`npm run render`、`npm run examples` 仍为保留的旧独立渲染脚本，不是新版后台 draw.io 导出的验收入口。真实原生证据见 [文档中心](docs/README.md)内各验证报告。当前 npm 与 Registry 正在准备，尚未完成公开发布；不是公开远程 MCP 服务，也未上架插件商店。

| 现象 | 检查 |
|---|---|
| 打开还是旧页面 | 使用 `/#/native`，设置 pilot 与独立根，确认已构建且连接的是新版 Runtime |
| 能看页面但不能保存 | 查看 `/studio-api/health` 能力/工作区身份；不要把另一个根或旧进程当当前服务 |
| 导出缺资源/字体 | 运行 `npm run setup:runtime` 与 `npm run check:runtime`，不是安装任意系统字体替代固定供应 |
| MCP 找不到工具 | 核对绝对路径与 env，重新加载 MCP 配置；旧进程不会自动使用新源码 |
| 保存冲突 | 保留草稿，读取远端最新修订再合并；不能自动覆盖或复活已删除 ID |

D01–D06 与 G1、后续若干 UI/布局/外观小批有各自验收记录；**D07/D08/D09/G2 不因本次 v1.0.0 标签自动变为整体验收通过**。详见 [实施计划](docs/IMPLEMENTATION_PLAN.md)与[台账](docs/DEVELOPMENT_TRACKER.md)。主项目采用 [MIT](LICENSE)；draw.io、浏览器、字体和依赖保留各自许可，MIT 不替代第三方条款。
