# FlyMind Studio

给 AI 使用的独立绘图引擎与网页编辑器。Codex 编写 JSON，FlyMind MCP 保存和渲染图形，用户在网页继续编辑，AI 读取最新版本再修改与交付。无需模型 API Key。

[绘图规则](docs/AI_DRAWING_GUIDE.md) · [Codex 配置](docs/CODEX_SETUP.md) · [研究与路线](docs/ROADMAP.md) · [贡献](CONTRIBUTING.md) · [安全](SECURITY.md) · [变更](CHANGELOG.md)

## 启动

Node.js 20.19+（20 系列）或 22.12+：

```powershell
npm ci
npm run build
npm run setup:codex
npm run dev
```

开发页面：<http://127.0.0.1:5178/>。共享服务使用 5179。生产运行 `npm start`，打开 <http://127.0.0.1:5179/>。`start-studio.ps1` 也可启动开发环境。

注册后重新加载 Codex MCP 配置，让新会话发现 `flymind` 工具。MCP 首次绘图调用可自动启动本机编辑服务。详细配置见 [连接 Codex](docs/CODEX_SETUP.md)。

### 其他支持本地 STDIO 的 MCP 客户端

先克隆仓库并完成上述安装和构建，再将路径替换为实际绝对路径：

```json
{
  "mcpServers": {
    "flymind": {
      "command": "node",
      "args": ["D:/AIBuilder/PM/flyMind/server/start.mjs"],
      "env": { "FLYMIND_DATA_DIR": "D:/AIBuilder/PM/flyMind/data" }
    }
  }
}
```

不同客户端的配置文件位置和外层字段不同；这里是通用示例。已用 SDK 的真实 STDIO 客户端验证协议，Codex 配置另见专门文档。MCP 使用 STDIO；5179 是网页/制品 HTTP 服务，**不是 HTTP MCP 端点**。目前没有 npm 发布包、远程 MCP 服务或 Registry 上架。

| 环境变量 | 默认值 | 用途 |
|---|---|---|
| `FLYMIND_DATA_DIR` | 仓库下 `data` | MCP 与网页必须共用的数据目录 |
| `FLYMIND_PORT` | `5179` | 本机网页服务端口 |
| `FLYMIND_EDITOR_URL` | `http://127.0.0.1:5179` | 返回的编辑页面地址；开发时可指定 5178 |
| `FLYMIND_AUTO_WEB` | 自动启动 | 设为 `0` 禁止 MCP 自动启动网页服务；此时链接需要自行启动服务 |

## AI 绘图

完整规则：[AI 绘图说明](docs/AI_DRAWING_GUIDE.md)。网页底部“AI 绘图说明”可直接查看；MCP 的 `get_drawing_guide` 返回相同文档和指定图形的完整模板。

| 类型 | JSON kind | 表达能力 |
|---|---|---|
| 泳道图 | swimlane | 角色、阶段、判断分支、循环、横向/纵向 |
| 流程图 | flowchart | 开始/结束、处理、判断、有向关系与回流 |
| 架构图 | architecture | 分层、模块、模块条目、治理区 |
| 思维导图 | mindmap | 中心主题、父子主题、分支 |
| 数据流架构图 | dataflow | 系统卡片、多源汇聚、集成横幅、反馈闭环 |

数据流架构图使用卡片表达，不是严格 DFD 标准符号。当前不宣称覆盖全部 UML 或 BPMN。

调用顺序：`get_drawing_guide → create_diagram → get_diagram → patch_diagram`。创建和修改直接返回 PNG 图片、SVG/JSON/draw.io 文件及编辑链接。单独重新导出用 `export_diagram`。修改前读取最新 `revision`，以 `expectedRevision` 提交；过期修改会被拒绝。工具共有 10 个，支持完整替换和原子增量操作。

可以对 Codex 说：

> 使用 FlyMind，按这些材料绘制泳道图，返回图片、SVG/JSON 和编辑链接。保留判断出口和回流。

> 读取图形 ID xxx 的最新版本，把售前咨询拆成两个步骤，保留我在网页调整的颜色和位置，再给我图片。

### 工具契约

工具发现返回字段级输入 schema、输出 schema、标题和行为注解。注解是客户端提示，不是权限控制。

| 工具 | 输入 | 成功结果 / 效果 |
|---|---|---|
| `get_drawing_guide` | 可选 `kind` | `guide` 和可选纯内容 `sample` |
| `list_diagrams` | 无 | `diagrams` 元数据列表 |
| `get_diagram` | `id`、可选 `preview` | 元数据与 `content`；preview=true 返回制品 |
| `validate_diagram` | `content` | `valid`、尺寸、节点和连线数量；不保存 |
| `create_diagram` | `content` | 保存新图形、PNG 和制品 |
| `update_diagram` | `id`、`expectedRevision`、`content` | 替换内容，保留渲染配置 |
| `patch_diagram` | `id`、`expectedRevision`、`operations` | 原子执行 1–500 项语义操作 |
| `get_rendering_config` | `id` | 独立 `rendering` 与标准配置 `standards` |
| `configure_rendering` | `id`、`expectedRevision`、`rendering` | 替换完整渲染配置，内容保持不变 |
| `export_diagram` | `id` | 导出当前版本的图片和制品 |

制品结果的 `structuredContent` 包括 `diagramId/title/kind/revision/editorUrl`、`files`（本机绝对路径）、`urls`（本机下载链接）、`resources`（MCP 可读取 URI）、`width/height`；PNG 另以原生 image 块返回。资源有 `flymind://guide`、`flymind://diagrams/{id}`、`flymind://artifacts/{id}/{revision}/{format}`，format 为 png/svg/json/project.json/drawio。资源链接可通过 MCP `resources/read` 读取，旧版本对应已生成的制品。

执行失败返回 `isError: true` 和 `{error:{code,message,currentRevision?}}`，常见 code 为 `CONFLICT/NOT_FOUND/BUSY/VALIDATION_FAILED/INTERNAL_ERROR`。输入 schema 不合法由 SDK 拒绝，具体错误格式由 SDK 决定。CONFLICT 重新读取并合并；BUSY 稍后重新读取；校验失败修正参数。禁止自动覆盖版本冲突。

## 网页编辑

- 框选、Shift 追加框选/多选、批量拖动、复制节点及内部连线、对齐和等距分布。
- 拖动自动吸附节点边缘与中心并显示辅助线；多选保留相对位置，Alt 暂时绕过吸附。
- 双击节点直接编辑文字；单节点八方向手柄调整尺寸，Shift 保持比例；属性面板设置位置、尺寸、配色、字号。连接端口位于手柄外侧，避免误操作。
- 从节点四侧端口拖出连线；拖动连线端点改接节点；拖动折点或双击线路增加折点；拖动分支文字位置。
- 调整起点/终点、端口、箭头、虚线、颜色和线宽，恢复自动路径。
- 增删泳道、阶段和分层，调整顺序；删除有节点的分组时指定迁移目标。
- 思维导图通过父主题调整关系；删除主题同时删除子分支。
- 自动布局、撤销/重做、文件复制、搜索与删除；导入 JSON/FMD/Markdown。
- 导出 PNG、SVG、JSON 内容、完整工作区、draw.io；思维导图另支持 FMD。draw.io 文件可在 draw.io 中继续编辑，当前不支持 XML 回读。

快捷键：V 选择、H 移动画布、C 连线；空格或中键拖动画布；Ctrl+滚轮缩放；Shift+1 适应全部、Shift+2 适应所选；Ctrl+A 全选、Ctrl+D 复制、方向键微调（Shift 加快）、Delete 删除、Ctrl+Z 撤销、Ctrl+Shift+Z 重做、Ctrl+S 保存。拖动/缩放时 Esc 取消，完成手势后一次保存与撤销。节点文字编辑时 Enter 保存，Shift+Enter 换行，Esc 取消。打开属性面板不重置缩放；缩放控件的适应按钮按当前选择聚焦。

目前是可平移缩放的图纸工作区，位置仍有图纸边界；真正的无限画布、系统剪贴板、组合/锁定/图层顺序和整体多选缩放尚未实现，执行顺序见 [路线](docs/ROADMAP.md)。

## 数据与独立组件

```text
src/drawing/core/         纯文档模型、校验、布局、渲染、增量修改
src/drawing/ui/           画布与工作区；画布通过 props/事件通信
src/drawing/state/        选择、编辑历史和文件管理
src/drawing/services/     共享服务适配、浏览器导出
server/store.ts          跨进程文件锁、原子保存、版本保护
server/runtime.ts        网页共享接口和本机编辑服务
server/mcp.ts            Codex MCP 工具与资源
server/artifacts.ts      SVG / PNG / JSON / draw.io 制品
```

内容层 `content` 只含节点、类型、关系和可选语义颜色，不含 order、坐标或美化数据。独立 `rendering` 管理标准节点大小/形状/配色、连线走线及手动覆盖。普通 MCP 工具仅接收 content；视觉调整单独使用 get_rendering_config / configure_rendering。存储和工作区导出为 `{schemaVersion:2,content,rendering,updatedAt}`；内容 JSON 导出仅包含语义数据。网页属性与源码编辑均区分内容/渲染标签。旧文档自动迁移。布局生成临时场景，渲染不修改节点层。`core/index.ts` 不依赖 Vue store、AI 平台、项目管理、认证或 API Key；后续功能作为外围适配器接入。

网页与 MCP 共用 `data/diagrams/`。版本制品放在 `data/artifacts/<id>/r<revision>/`，保留每次交付。浏览器 localStorage 作为本地备份；首次连接会迁移旧图形，冲突存档另存副本。网页保存遇到版本冲突时，可载入最新或把本地修改另存副本。本阶段只提供本机共享，编辑链接不能作为跨设备公开链接。

`data/`、环境变量文件、日志、依赖和测试截图不提交到 GitHub。换机器时需要另行备份 data/。

## 验证与独立渲染

```powershell
npm test
npm run build
npm run render -- examples/swimlane.json output/swimlane.svg
npm run render -- examples/architecture.json output/architecture.drawio
npm run examples
```

测试覆盖节点与渲染分离、五类布局、循环分支、输入校验、多人版本冲突、批量编辑及真实 STDIO MCP 的图片与文件交付。

源项目 `D:\AIBuilder\flyMind` 保留不动；原应用副本入口在 `/#/legacy`，其 AI 后端仍使用原配置。五类参考示例位于 examples/；泳道图截图之外的“项目交付”是演示补充，不代表原业务记录。

## 排查与维护

- 工具未更新：重新加载客户端 MCP；已启动的进程不会自动换成新源码。
- 页面打不开：运行 `npm run build` 和 `npm start`，检查端口与数据目录；健康检查 `http://127.0.0.1:5179/studio-api/health`。
- 图片中文缺字：检查服务器机器的中文字体；SVG 浏览器预览和服务端 PNG 使用的字体环境可能不同。
- STDIO stdout 只传 MCP 协议，诊断写 stderr。不要在 server 启动路径添加 console.log。

CI 在 Windows 和 Linux 执行锁文件安装、构建、核心测试和真实 MCP 回归。开发与发布要求见 [贡献说明](CONTRIBUTING.md)。仓库目前未提供项目许可证；原应用授权仍需核实，暂不宣称 MIT 等开源授权。
