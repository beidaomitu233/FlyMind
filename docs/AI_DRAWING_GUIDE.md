# FlyMind：AI 绘图说明

这份说明面向通过 Codex 或其他 MCP 客户端使用 FlyMind 的 AI，也可供开发者和人工编辑者参考。AI 根据业务材料编写 JSON；FlyMind 负责校验、布局、渲染和存储。无需在 FlyMind 内配置模型 API Key。

## 1. 完整工作链路

1. 调用 `get_drawing_guide`，可传 `kind` 获取完整示例。
2. 根据材料选择图形类型，编写语义节点、关系和必要的呈现配置。
3. 可先调用 `validate_diagram`。无效字段和不存在的引用会返回可修正错误。
4. 调用 `create_diagram`。使用唯一 ID，不重复使用示例 ID。
5. 返回结果包含 PNG 图片内容、`diagramId`、`revision`、`editorUrl`、文件路径 `files` 和下载地址 `urls`。向用户展示 PNG，并给出编辑链接和 SVG/JSON 下载链接，不能只返回一段 JSON。
6. 用户打开编辑链接，进行人工修改，自动保存到与 MCP 相同的共享文件存储。
7. 再次修改前调用 `get_diagram`，读取当前 JSON 和最新版本；用 `patch_diagram` 增量修改，或用 `update_diagram` 提交完整文档。必须传 `expectedRevision`。
8. 版本冲突表示有新的人工或 AI 修改；重新读取并合并，不能自动覆盖。网页冲突时可载入最新，或把本地修改另存为副本。

AI 不应把用户参考截图作为不可编辑背景，也不应编造业务角色、判断分支和系统关系。图片中的正文、图标、连接线、分组必须对应可编辑数据。未知内容应向用户说明。

## 2. 支持的图形

| kind | 名称 | 适用表达 | 节点与布局要求 |
|---|---|---|---|
| swimlane | 泳道图 | 谁在什么阶段做什么 | 节点有 laneId；定义了阶段时有 phaseId；order 表示阶段内步骤行 |
| flowchart | 流程图 | 步骤、判断、分支、循环 | task/decision/start/end；edges 表达方向；order 可固定行，省略时自动排序 |
| architecture | 架构图 | 分层、模块、功能条目、治理区 | module 节点有 groupId；groups 是从上到下的分层；模块内部条目用 items |
| mindmap | 思维导图 | 中心主题与树状拆分 | topic 节点；用 parentId，恰好一个中心主题，父子关系不能循环 |
| dataflow | 数据流架构图 | 系统集成、多源输入、处理卡片、反馈闭环 | card/note；description 显示在画布；order 定义行；支持横幅、图标和反馈边 |

完整可运行示例在 `examples/{kind}.json`。SVG 和 draw.io 示例也在同目录。数据流架构图是卡片式表达，没有实现严格 DFD、UML、BPMN 的全部标准符号；不要把这些标准的任意模型称作已支持。

## 3. 文档结构与数据分离

```json
{
  "schemaVersion": 1,
  "id": "order-process-001",
  "title": "订单处理流程",
  "kind": "flowchart",
  "nodes": [
    {"id": "start", "label": "收到订单", "kind": "start"},
    {"id": "review", "label": "库存是否充足？", "kind": "decision"},
    {"id": "ship", "label": "发货", "kind": "task"},
    {"id": "wait", "label": "等待补货", "kind": "task"},
    {"id": "done", "label": "完成", "kind": "end"}
  ],
  "edges": [
    {"id": "e1", "source": "start", "target": "review"},
    {"id": "e2", "source": "review", "target": "ship", "label": "是"},
    {"id": "e3", "source": "review", "target": "wait", "label": "否"},
    {"id": "e4", "source": "wait", "target": "review"},
    {"id": "e5", "source": "ship", "target": "done"}
  ],
  "lanes": [], "phases": [], "groups": [],
  "presentation": {"theme": "indigo", "orientation": "vertical", "positions": {}},
  "updatedAt": 0
}
```

节点层是 `nodes / edges / lanes / phases / groups`：只存含义与关系。呈现层是 `presentation`：存配色、图标、手动坐标、尺寸、端口和折点。禁止在 nodes 中写 x/y/width/height/style/icon/tone/fill/stroke/textColor/fontSize。SVG 是渲染产物，不是源数据。

### 文档与节点字段

| 字段 | 规则 |
|---|---|
| schemaVersion | 必须为 1；兼容原有示例 JSON |
| id | 文档 ID 为 1–100 位字母、数字、下划线、短横线；创建时唯一，更新时保持不变 |
| title | 1–160 字 |
| nodes | 1–500 个；每个 id 唯一，label 为 1–500 字 |
| nodes.kind | task、decision、start、end、module、topic、card、note |
| laneId / phaseId / groupId | 引用已有的泳道、阶段、分层 |
| parentId | 引用已有父主题；思维导图中心主题没有此字段 |
| order | 0–200 整数；泳道图为阶段内行；流程图/数据流图为布局行 |
| description | 最多 4000 字；数据流图显示正文，其他图形作为备注；换行写 `\n` |
| items | 架构模块内部条目，最多 30 项，每项最多 200 字 |
| badge | 架构模块标记，最多 30 字，例如 1期/2期/3期 |
| edges | 最多 2000 个；id 唯一，source/target 都必须存在，label 最多 200 字 |
| edges.dashed | true 显示虚线 |
| edges.kind | flow 或 feedback；dataflow 中 feedback 使用回流绕行布局 |
| lanes / phases | 数组元素为 `{id,label}`，顺序决定位置；各最多 30 个 |
| groups | `{id,label,tone?,kind?}`；tone=blue/green/amber，kind=layer/governance；各最多 30 个 |
| updatedAt | 时间戳；保存时服务自动更新 |

不要为思维导图额外创建父子 edges；连接线由 parentId 自动生成。普通图形的连线必须显式写在 edges 中。所有判断的出口和循环关系都应保留，不能为让页面好看而删去业务分支。

## 4. 各类图形怎么绘制

### 泳道图

lanes 表示角色；phases 表示阶段。同一阶段内跨角色同时发生的活动使用相同 order。每个步骤属于一个角色和一个阶段；角色责任变化用跨泳道连接线。

```json
{
  "schemaVersion":1,"id":"review-swim-001","title":"需求评审","kind":"swimlane",
  "lanes":[{"id":"customer","label":"客户"},{"id":"pm","label":"产品经理"}],
  "phases":[{"id":"intake","label":"需求导入"},{"id":"review","label":"评审"}],
  "groups":[],
  "nodes":[
    {"id":"request","label":"提出需求","kind":"task","laneId":"customer","phaseId":"intake","order":0},
    {"id":"analyze","label":"分析需求","kind":"task","laneId":"pm","phaseId":"intake","order":0},
    {"id":"agree","label":"是否确认？","kind":"decision","laneId":"customer","phaseId":"review","order":0},
    {"id":"revise","label":"修改方案","kind":"task","laneId":"pm","phaseId":"review","order":1},
    {"id":"done","label":"确认完成","kind":"end","laneId":"pm","phaseId":"review","order":2}
  ],
  "edges":[
    {"id":"e1","source":"request","target":"analyze"},
    {"id":"e2","source":"analyze","target":"agree"},
    {"id":"e3","source":"agree","target":"revise","label":"否"},
    {"id":"e4","source":"revise","target":"agree"},
    {"id":"e5","source":"agree","target":"done","label":"是"}
  ],
  "presentation":{"theme":"indigo","orientation":"vertical","positions":{}},"updatedAt":0
}
```

纵向是角色列、阶段行；horizontal 是角色行、阶段列。跨泳道或阶段拖动会更新归属。手动改 laneId/phaseId/order 后，应删除该节点位置覆盖，让它进入新的布局。

### 流程图

用 start/end 表示起止，task 表示处理，decision 表示判断。省略 order 时引擎按连线拓扑排布；循环仍保留。若需指定同一行的分支，可为节点写相同 order。orientation 可 vertical/horizontal。反复引用同一个节点 ID 就是同一业务步骤，不要用复制文字假装循环。

### 架构图

按上到下顺序写 groups；分层名称可含换行。模块节点为 kind=module 且有 groupId，内部功能条目写 items。tone 设置整层基调，badge 标示期次。governance 组会显示在右侧治理栏；当前布局只支持一个治理栏。

### 思维导图

一个中心 topic 没有 parentId，其他 topic 指向父主题。节点数组顺序决定分支顺序。可以导入原 FMD 和 Markdown；可导出 FMD。拖动只改呈现位置；调整归属必须更新 parentId，移动一个分支需一起选择分支节点或修改树结构。

### 数据流架构图

card 的 label 为标题，description 为可见正文；note 为纯文字注释。order 是布局行：同一行等宽排布，单卡片行自动铺满。反馈边使用 kind=feedback。多源输入连接宽横幅时采用独立入口。

```json
{
  "schemaVersion":1,"id":"data-loop-001","title":"数据处理闭环","kind":"dataflow",
  "nodes":[
    {"id":"source","label":"业务系统","description":"订单与客户数据","kind":"card","order":0},
    {"id":"gateway","label":"集成平台","description":"字段映射  身份核验","kind":"card","order":1},
    {"id":"analysis","label":"分析","description":"处理数据并生成建议","kind":"card","order":2},
    {"id":"review","label":"人工确认","description":"复核  签名  回写","kind":"card","order":2}
  ],
  "edges":[
    {"id":"read","source":"source","target":"gateway"},
    {"id":"process","source":"gateway","target":"analysis"},
    {"id":"confirm","source":"analysis","target":"review"},
    {"id":"feedback","source":"review","target":"analysis","label":"反馈证据","kind":"feedback"}
  ],"lanes":[],"phases":[],"groups":[],
  "presentation":{"theme":"blue","orientation":"vertical","positions":{},"cards":{
    "source":{"icon":"database"},"gateway":{"variant":"band","tone":"teal"},
    "analysis":{"icon":"network"},"review":{"icon":"check","tone":"teal"}
  }},"updatedAt":0
}
```

## 5. 怎么配色与控制布局

默认先用主题和自动布局。仅在确有展示需求时增加局部样式和坐标；重新生成不应无故抹掉用户手动位置。

| 配置 | 可用值 / 作用 |
|---|---|
| presentation.theme | blue 蓝色、indigo 靛蓝、forest 青绿 |
| presentation.positions[nodeId] | 可选 x、y、width、height；最小尺寸 32，数值绝对值最多 50000 |
| presentation.styles[nodeId] | fill、stroke、textColor（必须 `#RRGGBB`），fontSize（10–48） |
| presentation.cards[nodeId] | icon=database/network/check/none；tone=blue/teal；variant=card/band |
| presentation.edges[edgeId] | color、width（1–8）、arrow（end/both/none）、sourcePort、targetPort、points、labelPosition |
| 端口 | top/right/bottom/left；省略为自动选择 |
| points | 中间路径点数组，每项 `{x,y}`，不含端点，最多 40 个；手动路径按顺序连接；空数组表示直线 |
| labelPosition | `{x,y}` 固定连接线标签位置 |

```json
{
  "theme":"blue","orientation":"vertical",
  "positions":{"review":{"x":400,"y":260,"width":220,"height":100}},
  "styles":{"review":{"fill":"#edf8f2","stroke":"#249568","textColor":"#194c70","fontSize":18}},
  "edges":{"e2":{"color":"#249568","width":2,"sourcePort":"right","targetPort":"left","points":[{"x":360,"y":310}],"arrow":"end"}}
}
```

以上片段是 presentation，需要嵌入完整图形。自动布局会清除位置和路径覆盖，并保留局部颜色、线宽与箭头设置。描述文字较长时，数据流卡片自动换行并撑高；用户手动指定过小高度时需自行增大高度。

## 6. 获得图形与二次修改

### MCP 工具

| 工具 | 输入 | 输出 / 用途 |
|---|---|---|
| get_drawing_guide | 可选 kind | 规则，及所选完整模板 |
| validate_diagram | document | 校验结果与画布尺寸，不创建文件 |
| list_diagrams | 无 | ID、类型、版本、编辑链接 |
| get_diagram | id，preview 可选 | 最新 document 和 revision；preview=true 同时导出图片 |
| create_diagram | document | revision=1、PNG 内容、制品与编辑链接 |
| update_diagram | id、expectedRevision、document | 完整替换，版本+1，重新导出 |
| patch_diagram | id、expectedRevision、operations | 原子增量修改，版本+1，重新导出 |
| export_diagram | id | 当前版本的 PNG、SVG、JSON、draw.io |

AI 修改示例：先读取，再仅调整指定节点和配色。

```json
{
  "id":"review-swim-001","expectedRevision":3,
  "operations":[
    {"op":"update_node","id":"revise","changes":{"label":"产品经理调整方案"}},
    {"op":"set_node_presentation","id":"revise","style":{"fill":"#edf8f2","stroke":"#249568"}},
    {"op":"update_edge","id":"e3","changes":{"label":"需修改"}}
  ]
}
```

expectedRevision 必须用实际读取值，3 只是示例。整个 operations 一起校验；任何操作失败都不写入，避免产生半张坏图。

### 增量操作

| op | 参数 |
|---|---|
| add_node | node，可选 position、style |
| update_node | id、changes（语义字段，不修改 id） |
| remove_node | id；自动清理相关边与呈现配置；思维导图删除其后代；至少保留一个节点 |
| add_edge | edge，可选 style |
| update_edge | id、changes（source/target/label/dashed/kind） |
| remove_edge | id |
| set_node_presentation | id，可选 position、style、card，按字段合并 |
| set_edge_presentation | id、style，按字段合并 |
| add_container | collection=lanes/phases/groups、item，可选 index |
| update_container | collection、id、changes |
| reorder_container | collection、id、index（从 0 开始） |
| remove_container | collection、id；有节点时必须提供 moveTo（同类其他分组） |
| set_title | title |
| set_theme | theme |
| reset_layout | 无；恢复自动布局 |

分组重排或删除会重新布局，清除手动位置、端口和折点，保留配色与线型。若需要指定新的手动布局，在同一批 operations 的最后设置节点位置与连线路径。服务断开时网页保留未同步内容；恢复后可重试同步。重新加载时，尚未同步且与远端不同的图形会另存为“本地存档”，避免覆盖任何一方。

### 人工编辑

- 双击节点原位编辑标题，Enter 保存，Shift+Enter 换行，Esc 取消；属性面板编辑正文、模块条目、角色或分组归属。
- 拖动节点移动；右下角手柄调整尺寸；“位置与样式”输入精确坐标、宽高、颜色和字号。
- 框选或 Shift/Ctrl 点击多选。Ctrl+A 全选；Ctrl+D 复制；属性面板提供对齐和等距分布。方向键移动 1，Shift+方向键移动 10。
- 从节点四周端口拖到另一节点可连线，也可使用 C 工具依次点击起点、终点。
- 选中连线后拖动两端到其他节点以重连；拖动中间手柄调整路径，双击连线新增折点；拖动标签改变标签位置。属性面板编辑箭头、颜色、线宽、虚线和端口，或恢复自动路径。
- 分组属性可前后移动；删除有内容的分组时，先选择节点迁移目标。调整思维导图父主题时会校验循环。
- Ctrl+Z 撤销，Ctrl+Shift+Z 重做。空格+拖动或 H 移动画布；Ctrl+滚轮缩放。
- 自动保存；共享状态显示“保存中/已保存”。本地备份用于服务断开时保留当前内容。

### 导出与交付

- PNG：直接给用户看的图片；MCP 内容包含图片，网页可下载。
- SVG：矢量图片，保留清晰文字与图形。
- JSON：可继续编辑的完整源数据，应作为后续修改依据。
- draw.io：可编辑交换格式；样式由 draw.io 解释，当前不支持导入 draw.io XML。
- FMD：仅思维导图，网页导出或独立旧格式适配。

文件保存到 `data/artifacts/{diagramId}/r{revision}/`，每个版本独立。`editorUrl` 在本机打开同一图形；localhost 链接不能发给其他设备当作云端分享链接。AI 给用户展示本地图片时，可用返回的 `files.png` 绝对路径；例如 `![图形](绝对路径)`，再附 editorUrl 和 SVG/JSON 链接。任何原文件修改都不会自动更改 GitHub；源代码与图形数据的发布是不同操作。

## 7. 无 MCP 时的命令行方式

```powershell
npm run render -- examples/swimlane.json output/swimlane.svg
npm run render -- examples/dataflow.json output/dataflow.drawio
```

这条命令只渲染给定文件，不把它放进共享工作区。共享编辑与直接返回 PNG 应走 MCP 的 create/patch/export 工具。Codex 安装与配置见 `docs/CODEX_SETUP.md`。
