# FlyMind：AI 绘图说明

AI 提供内容，FlyMind 自动布局并渲染。普通绘图只提交 `content`，无需 API Key、坐标或美化配置。

## 1. 两层职责

| 层 | 负责 | 不负责 |
|---|---|---|
| 内容 content | 节点内容、节点类型、连接关系、角色/阶段/分组、可选语义颜色 | 坐标、布局行、尺寸、形状、字体、图标、线型 |
| 渲染 rendering | 标准节点配置、主题、大小、形状、配色、连线类型、自动布局及手动覆盖 | 修改业务文字、角色职责、连接关系 |

内容 JSON 不包含 `presentation`、`rendering`、`updatedAt`，节点不包含 `order`。内容工具会拒绝这些字段。普通 AI 绘图也不需要写 `ranks` 或手动位置。渲染层根据关系排序、分支排布、避开同泳道节点和反馈循环、换行、撑开卡片，采用标准配色与形状。

仅当用户明确要求改变视觉表现时，读取 `get_rendering_config` 后单独调用 `configure_rendering`。业务步骤是否存在、连接到谁，不能为了美观被改变。

## 2. 支持的图形

| kind | 图形 | 内容规则 |
|---|---|---|
| swimlane | 泳道图 | lanes 是角色，phases 是阶段；节点有 laneId，有阶段时必须有 phaseId；edges 表达交接与分支 |
| flowchart | 流程图 | start/end/task/decision；edges 表达方向、判断出口与回流 |
| architecture | 分层架构图 | groups 为分层；module 节点有 groupId；items 为模块功能条目 |
| mindmap | 思维导图 | topic 与 parentId；恰好一个没有 parentId 的根主题，父子不能循环 |
| dataflow | 数据流架构图 | card 为带标题和正文的节点，note 为注释；反馈边 kind=feedback |

`examples/{kind}.json` 是纯内容示例；`{kind}.project.json` 是保留参考样式的完整工作区。SVG 与 draw.io 是渲染产物。数据流架构图采用卡片表达，不覆盖严格 DFD、UML 或 BPMN 的全部标准符号。

## 3. 内容 JSON

下面内容可以直接传入 `create_diagram` 的 `content` 参数，或导入网页：

```json
{
  "schemaVersion": 1,
  "id": "order-process-001",
  "title": "订单处理流程",
  "kind": "flowchart",
  "nodes": [
    {"id":"start","label":"收到订单","kind":"start"},
    {"id":"review","label":"库存是否充足？","kind":"decision"},
    {"id":"ship","label":"发货","kind":"task"},
    {"id":"wait","label":"等待补货","kind":"task"},
    {"id":"done","label":"完成","kind":"end"}
  ],
  "edges": [
    {"id":"e1","source":"start","target":"review"},
    {"id":"e2","source":"review","target":"ship","label":"是"},
    {"id":"e3","source":"review","target":"wait","label":"否"},
    {"id":"e4","source":"wait","target":"review"},
    {"id":"e5","source":"ship","target":"done"}
  ],
  "lanes": [], "phases": [], "groups": []
}
```

| 字段 | 规则 |
|---|---|
| schemaVersion | 内容版本 1；省略时自动补齐 |
| id | 1–100 位字母、数字、下划线或短横线；省略时生成；创建时唯一 |
| title / kind | 标题 1–160 字；kind 为上表五种之一 |
| nodes | 1–500 个；id 唯一，label 为 1–500 字，kind 为 task/decision/start/end/module/topic/card/note |
| color | 节点或分层可选语义颜色，必须 #RRGGBB；省略采用渲染主题；不是必填的美化字段 |
| laneId / phaseId / groupId | 引用现有角色、阶段、分层 |
| parentId | 指向父主题；思维导图根主题省略 |
| description | 最多 4000 字；数据流图显示正文，其余作为备注；换行写 \n |
| items / badge | 模块条目最多 30 项，每项最多 200 字；业务标记最多 30 字 |
| edges | 最多 2000 个；id 唯一，source/target 存在；label 最多 200 字；kind 可为 flow/feedback |
| lanes / phases | `{id,label}`；各最多 30 个；数组顺序表达角色与阶段顺序 |
| groups | `{id,label,kind?,color?}`；kind=layer/governance，最多 30 个；当前只显示一个右侧治理栏 |

edges/lanes/phases/groups 可省略，自动补空数组。思维导图通过 parentId 自动生成连线，无需额外 edges。其他图形必须显式描述连线。判断出口标注“是/否”或具体业务条件；保留循环和异常分支。

### 泳道图

```json
{
  "title":"需求评审","kind":"swimlane",
  "lanes":[{"id":"customer","label":"客户"},{"id":"pm","label":"产品经理"}],
  "phases":[{"id":"intake","label":"需求导入"},{"id":"review","label":"评审"}],
  "nodes":[
    {"id":"request","label":"提出需求","kind":"task","laneId":"customer","phaseId":"intake"},
    {"id":"analyze","label":"分析需求","kind":"task","laneId":"pm","phaseId":"intake"},
    {"id":"agree","label":"是否确认？","kind":"decision","laneId":"customer","phaseId":"review"},
    {"id":"revise","label":"修改方案","kind":"task","laneId":"pm","phaseId":"review"},
    {"id":"done","label":"确认完成","kind":"end","laneId":"pm","phaseId":"review"}
  ],
  "edges":[
    {"id":"e1","source":"request","target":"analyze"},
    {"id":"e2","source":"analyze","target":"agree"},
    {"id":"e3","source":"agree","target":"revise","label":"否"},
    {"id":"e4","source":"revise","target":"agree"},
    {"id":"e5","source":"agree","target":"done","label":"是"}
  ]
}
```

渲染器按阶段和连接关系自动推导步骤行。跨角色交接尽量排在同一行，同一角色步骤避免重叠。纵向是角色列、阶段行，横向在渲染配置里切换。拖动跨泳道/阶段会改变实际业务归属，普通拖动只改渲染位置。

### 其他类型

- 流程图：用 start/end 起止，task 处理，decision 判断。自动排序保留循环；回边不会把整条循环挤到同一行。
- 架构图：groups 按层次顺序排列；module 有 groupId，条目放 items，期次等业务标记放 badge。列数和层色由渲染配置负责。
- 思维导图：topic + parentId。数组顺序决定同级分支顺序；父主题调整会校验循环。支持 Markdown/FMD 导入。
- 数据流架构图：card 的 label 为标题，description 为正文；note 为独立注释；edges 描述读入、汇聚、分析、确认、回写。反馈边 kind=feedback；无需布局行、横幅、图标或配色配置即可生成。

## 4. 独立渲染配置

人工界面属性面板分为“内容”和“渲染”；“图形数据”也有独立的内容/渲染标签。修改其中一层保留另一层，删除对象时清理已失效的渲染覆盖。

| 配置 | 作用 |
|---|---|
| theme | blue/indigo/forest；未指定时使用该图形的默认主题 |
| orientation | vertical/horizontal，控制流程图与泳道图方向 |
| nodeDefaults[节点类型] | width/height（32–2000）、fontSize（10–48）、shape、fill/stroke/textColor（#RRGGBB） |
| shape | rectangle/rounded/ellipse/diamond；标准任务圆角、判断菱形、起止椭圆、模块矩形 |
| edgeDefaults | route=orthogonal/straight/curved，color、width（1–8）、arrow=end/both/none、dashed |
| positions[nodeId] | 手动 x/y/width/height；最小尺寸 32，数值绝对值最多 50000 |
| styles[nodeId] | 单节点覆盖 fill/stroke/textColor/fontSize/shape |
| edges[edgeId] | 单边覆盖 route/color/width/arrow/dashed/sourcePort/targetPort/points/labelPosition |
| groups[groupId] | tone=blue/green/amber，columns（1–10）；缺省自动决定列数 |
| cards[nodeId] | icon=database/network/check/none，tone=blue/teal，variant=card/band |
| ranks[nodeId] | 导入旧布局或人工明确安排的行号（0–200）；普通 AI 绘图不用写 |

架构模块和数据卡片宽度随容器伸缩，标准宽高作为排布尺寸基准；长正文自动撑高。单节点 positions 可覆盖最终宽高。颜色优先级：单节点渲染覆盖 > 节点标准渲染配置 > 可选内容颜色 > 自动主题。位置优先级：手动 positions > 自动布局。端口为 top/right/bottom/left；points 为中间路径点（最多 40 个，不含端点）；手动路径优先于标准走线。自动布局清除手动位置、布局行、端口、路径和标签位置，保留标准样式及颜色等局部配置。

例如用户明确要求“步骤统一 240×80、连线改直线”，先读取原渲染配置，保留其余字段，仅合并这些修改后提交 `configure_rendering`：

```json
{
  "id":"order-process-001","expectedRevision":3,
  "rendering":{
    "theme":"indigo","orientation":"vertical","positions":{},
    "nodeDefaults":{"task":{"width":240,"height":80,"shape":"rounded"}},
    "edgeDefaults":{"route":"straight"}
  }
}
```

示例 revision 不能照抄；实际使用刚读取的版本。默认绘图链路不需要这一步。

## 5. MCP 完整链路

1. `get_drawing_guide` 获取规则，可传 kind 获取纯内容模板。
2. 从业务材料写内容，必要时用 `validate_diagram({content})` 校验。
3. `create_diagram({content})`，自动布局、保存并输出图片。
4. 向用户展示 PNG，附 editorUrl 以及 SVG/内容 JSON/工作区下载链接。不要只交付 JSON。
5. 用户在网页修改，自动保存至与 MCP 相同的共享存储。
6. AI 修改前 `get_diagram` 读取最新 content/revision，再 `patch_diagram` 或 `update_diagram`。
7. 版本冲突时重新读取并合并人工修改，不能直接覆盖。

| 工具 | 参数 / 返回 |
|---|---|
| get_drawing_guide | kind 可选；规则与纯内容模板 |
| list_diagrams | 图形 ID、类型、最新 revision、编辑链接 |
| get_diagram | id，preview 可选；默认返回 content + revision；preview=true 返回图片与制品 |
| validate_diagram | content；不保存，返回尺寸和数量 |
| create_diagram | content；版本 1、PNG、制品路径和编辑链接 |
| update_diagram | id、expectedRevision、content；替换内容并保留渲染；类型改变时使用新类型默认渲染 |
| patch_diagram | id、expectedRevision、operations；仅接受内容操作 |
| export_diagram | id；当前版本 PNG、SVG、内容 JSON、工作区 JSON、draw.io |
| get_rendering_config | id；rendering、标准节点配置、有效节点标准、连线标准及 revision |
| configure_rendering | id、expectedRevision、rendering；替换渲染配置，保持内容不变 |

### 内容增量操作

| op | 参数 |
|---|---|
| add_node / update_node / remove_node | node / id+changes / id |
| add_edge / update_edge / remove_edge | edge / id+changes / id |
| add_container | collection=lanes/phases/groups，item，index 可选 |
| update_container | collection、id、changes（业务字段） |
| reorder_container | collection、id、index（从 0 开始） |
| remove_container | collection、id；包含节点时必须提供 moveTo |
| set_title | title |

一次 1–500 个操作；原子校验，任一步错误均不保存。禁止 position/style/card、set_theme、set_node_presentation 等渲染参数或操作。

```json
{
  "id":"order-process-001","expectedRevision":2,
  "operations":[
    {"op":"update_node","id":"ship","changes":{"label":"仓库确认后发货"}},
    {"op":"update_edge","id":"e2","changes":{"label":"库存充足"}}
  ]
}
```

删除节点自动清理相关边与渲染覆盖，思维导图删除后代；至少保留一个节点。跨分组调整清除失效位置；分组重排/删除重新布局并清除旧路径。稳定 ID 的文字修改保留人工坐标、样式、端口和折点。

## 6. 人工二次编辑与交付

- 双击节点原位编辑标题，Enter 保存、Shift+Enter 换行、Esc 取消；“内容”编辑类型、说明、模块条目、角色/阶段/分组或父主题。
- “渲染”编辑位置、尺寸、颜色、形状、字号、卡片图标、连接线路由和端口；可单独恢复标准配置。无选择时调整全图标准节点与连线配置。
- 拖动节点吸附边缘/中心并显示辅助线，Alt 临时绕过；单节点八方向手柄缩放，Shift 保持比例。框选/Shift 追加框选或多选，Ctrl+A 全选、Ctrl+D 复制；多选面板提供对齐与等距分布。方向键移动 1，Shift+方向键移动 10。Esc 取消手势，不写入文档；完成手势一次提交和撤销。
- 从四侧端口拖动连线；C 工具依次选择起终点；选中线后拖动端点重连、拖动折点或双击增加折点、拖动标签位置。
- 分组调整顺序；删除有节点的分组时选择迁移目标。Ctrl+Z 撤销、Ctrl+Shift+Z 重做；H 或空格拖动画布，Ctrl+滚轮缩放，Shift+1 适应全部、Shift+2 适应所选。打开属性面板保持视角。
- 自动保存与版本保护。断网保留未同步内容，恢复后重试；重新加载发现与远端不同的未同步存档会另存为本地存档。网页冲突可载入最新或另存本地副本。

| 交付物 | 用途 |
|---|---|
| PNG | 用户预览；MCP 直接返回图片内容及 files.png |
| SVG | 高清矢量产物 |
| JSON 内容数据 | 纯业务数据，可再次自动渲染；不包含手动美化配置 |
| 工作区 JSON | schemaVersion=2，包含分开的 content / rendering / updatedAt；保留全部手动编辑 |
| draw.io | 可编辑交换格式；当前不支持 XML 回读 |
| FMD | 网页思维导图兼容导出 |

存储结构是 `{schemaVersion:2,content:{...},rendering:{...},updatedAt:...}`。外层存储记录有 revision/savedAt；内容本身没有时间或版本锁字段。旧版本平铺文档通过导入/存储读取兼容：order → rendering.ranks、edges.dashed → rendering.edges、groups.tone → rendering.groups。兼容入口与新内容工具严格校验分开。

制品在 `data/artifacts/{diagramId}/r{revision}/`；JSON 内容为 diagram.json，完整工作区为 diagram.project.json。编辑链接仅本机使用。可在 Codex 回复中引用返回的 files.png 绝对路径展示图形，再给出编辑/下载链接。

MCP 制品结果同时提供 resources URI；可通过 resources/read 读取 `flymind://artifacts/{diagramId}/{revision}/{format}`（png/svg/json/project.json/drawio）。PNG 使用 base64 blob，其余返回文本；只读取已生成版本制品。成功结果有 structuredContent 和 outputSchema；执行错误以 isError 和 JSON 文本 `{error:{code,message,currentRevision?}}` 返回。CONFLICT 重新读取和合并，禁止强制覆盖。字段 schema 校验失败由 SDK 返回错误，不保证同一业务错误格式。

无 MCP 的独立渲染：`npm run render -- examples/swimlane.json output/swimlane.svg`；也可输入完整工作区文件以保留手动样式。这条命令不写入共享工作区。连接 Codex 见 `docs/CODEX_SETUP.md`。
