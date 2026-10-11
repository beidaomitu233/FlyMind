# FlyMind Studio

基于 `D:\AIBuilder\flyMind` 复制的第一阶段绘图工作区。打开首页即可新建和编辑泳道图、流程图、架构图、思维导图与数据流架构图，无需登录或启动后端。

在此目录运行 `npm run dev`，打开 <http://127.0.0.1:5178/>。也可以运行 `start-studio.ps1`。换机器使用 Node.js 20.19+，先运行 `npm ci`。生产构建：`npm run build`；核心检查：`npm test`。

## 绘图能力

- 泳道图：角色列、阶段行、判断节点、N/Y 分支、循环回流；支持横向和纵向。跨泳道拖动会同步更新角色归属。
- 流程图：独立节点与有向连线，支持循环；连线选择正交路径并避开其他节点。
- 架构图：分层、模块、模块内条目和贯穿各层的治理区。模块可编辑、拖动并重新布局。
- 思维导图：复用原项目的树形布局，支持主题编辑、添加子主题、父主题调整和分支删除。
- 数据流架构图：卡片式系统集成与数据闭环，支持多源汇聚、集成横幅、分析与人工确认、反馈回流和文字注释。可编辑标题、可见说明、布局行、图标与配色；升级后会向已有工作区补充一次医院系统集成示例，保留已有图形。
- 共用操作：拖拽、缩放、自动布局、连线、节点属性、撤销/重做、本地自动保存、JSON/FMD/Markdown 导入；导出 SVG、PNG、JSON、draw.io，思维导图另可导出 FMD。

快捷键：V 选择，H 移动画布，C 连线，Delete 删除选中对象，Ctrl+Z 撤销，Ctrl+Shift+Z 重做。双击节点进入文字编辑；Ctrl+滚轮围绕鼠标缩放。

`examples/architecture.*` 按图 1 的五层模块结构和治理区重绘。`examples/swimlane.*` 按图 2 的角色与阶段结构重绘；截图之外的“项目交付”阶段是展示功能用的补充示例，不代表原业务记录。图形文字均为可编辑数据，未把截图作为画布背景。

`examples/dataflow.*` 按医院系统集成截图重绘。这类图属于卡片式数据流架构表达，未使用严格 DFD 的标准符号。新建时选择“数据流架构图”，勾选“使用示例数据”即可复用。节点的 `order` 表示布局行；同一行等宽排列，单卡片行铺满。`description` 显示在标题下方；`kind=note` 显示独立文字。`presentation.cards` 保存图标、配色和卡片/横幅形式；`edges.kind=feedback` 让回流线从卡片下方绕行。拖动保留手动位置，自动布局清除手动位置并按行重排；说明文字会自动换行并撑高布局。

## 独立绘图边界

```text
src/drawing/
  core/model.ts       节点、连线、泳道、阶段和分层；输入校验
  core/layout.ts      节点关系 → 带几何位置的场景
  core/dataflow.ts    卡片布局、文字尺寸和数据回流路由
  core/render.ts      场景 → SVG / draw.io XML
  core/adapters.ts    JSON、旧 FMD 和 Markdown 适配
  state/studio.ts     文件、选中状态、编辑历史、本地存储
  ui/DiagramCanvas.vue  仅通过 props 和事件与宿主通信的画布
  ui/Studio.vue       当前工作区页面
  services/exports.ts 浏览器下载与 PNG 转换
```

节点层的 `nodes/edges/lanes/phases/groups` 只描述含义与关系。手动位置放在 `presentation.positions`，配色和方向也归 presentation。布局结果是临时场景，渲染器不修改原始节点数据。SVG 和 PNG 使用同一份场景，JSON 保留语义和手动位置。draw.io 是可编辑的交换导出，样式由 draw.io 自身解释；本阶段不提供 draw.io XML 回读。

`core/index.ts` 是绘图引擎入口，不依赖项目管理、认证、API Key、数据库或 Vue store。画布组件不调用业务服务。后续工作台的材料、MCP 和生成任务可作为外围适配器接入，绘图引擎接收经过校验的文档即可。

## 从 Codex 发起

页面的“图形数据”或“导入图形”弹窗中，点击“复制给 Codex”，把生成规则与当前图形结构粘贴进 Codex 对话。将 Codex 返回的 JSON 导入页面，即可编辑与导出。本阶段的新工作区不直接调用模型 API，也不宣称已连接 MCP。

独立渲染无需浏览器：

```powershell
npm run render -- examples/swimlane.json output/swimlane.svg
npm run render -- examples/architecture.json output/architecture.drawio
```

这条命令也可由 Codex 调用。`npm run examples` 可重新生成五类示例文件。

原项目页面和 AI 后端代码保留在副本中，原版入口为 `/#/legacy`，后端仍按原项目的配置启动。新工作区的数据单独存于当前浏览器的 `flymind-drawing-studio-v1`；建议通过 JSON 导出备份。跨浏览器和跨设备同步属于后续持久化适配工作。
