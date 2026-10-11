# FlyMind Studio

给 AI 使用的独立绘图引擎与网页编辑器。Codex 编写 JSON，FlyMind MCP 保存和渲染图形，用户在网页继续编辑，AI 读取最新版本再修改与交付。无需模型 API Key。

## 启动

Node.js 20.19+：

```powershell
npm ci
npm run build
npm run setup:codex
npm run dev
```

开发页面：<http://127.0.0.1:5178/>。共享服务使用 5179。生产运行 `npm start`，打开 <http://127.0.0.1:5179/>。`start-studio.ps1` 也可启动开发环境。

注册后重新加载 Codex MCP 配置，让新会话发现 `flymind` 工具。MCP 首次绘图调用可自动启动本机编辑服务。详细配置见 [连接 Codex](docs/CODEX_SETUP.md)。

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

## 网页编辑

- 框选、Shift 多选、批量拖动、复制节点及内部连线、对齐和等距分布。
- 双击节点直接编辑文字；拖动右下角调整尺寸；属性面板设置位置、尺寸、配色、字号。
- 从节点四侧端口拖出连线；拖动连线端点改接节点；拖动折点或双击线路增加折点；拖动分支文字位置。
- 调整起点/终点、端口、箭头、虚线、颜色和线宽，恢复自动路径。
- 增删泳道、阶段和分层，调整顺序；删除有节点的分组时指定迁移目标。
- 思维导图通过父主题调整关系；删除主题同时删除子分支。
- 自动布局、撤销/重做、文件复制、搜索与删除；导入 JSON/FMD/Markdown。
- 导出 PNG、SVG、JSON 内容、完整工作区、draw.io；思维导图另支持 FMD。draw.io 文件可在 draw.io 中继续编辑，当前不支持 XML 回读。

快捷键：V 选择、H 移动画布、C 连线；空格或中键拖动画布；Ctrl+滚轮缩放；Ctrl+A 全选、Ctrl+D 复制、方向键微调（Shift 加快）、Delete 删除、Ctrl+Z 撤销、Ctrl+Shift+Z 重做、Ctrl+S 保存。节点文字编辑时 Enter 保存，Shift+Enter 换行，Esc 取消。

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
