# FlyMind：AI 绘图说明

## 原生 pilot（D05）

仅在 `FLYMIND_NATIVE_PILOT=1` 与显式隔离数据根下启用；G2 前默认仍走旧入口。本节优先于下文旧引擎参数。实际支持集合以 get_drawing_guide 的 capabilities 为准，当前五类已适配。get_rendering_config 返回原生 profile/preferences；configure_rendering 先读取 get_rendering_config 及实际工具 schema，仅提交支持且需要修改的字段；切换方向需 relayout:true，不默认传坐标。

原工具名保持。content 必须有 `schemaVersion:1`、稳定 `id` 和全部业务数组（`groups:[]`）。create/patch/update 必须有稳定 `requestId`；同一请求重试保持 payload 不变。AI 新建须质量合格，历史人工草稿的修改不得新增或加重 error 或 warning，只有明确批注才用 annotation；来源缺口不得猜边修复。网页人工保存仍允许结构合法草稿。

原生 preview/create/patch/update/export 交付同一不可变修订的 PNG、SVG、drawio、json、project.json；`files` 为 Runtime 登记且摘要验证后的本机绝对路径，`resources` 含 exportId。默认等待最多 25 秒，返回 `saved:true` 且导出失败/等待超时时，沿 `jobId/exportRetry` 或 `export_diagram({id,requestId,retryJobId})` 处理已保存图形，禁止重新创建。只有 failed job 可显式 retry；queued/running 先读取状态，不重复排队。旧修订重放的标题/时间/图片锚原快照，`currentRevision/isCurrentRevision` 另列；workspaceGroupId 始终表示当前列表归属。validate 不返回未经渲染的假尺寸。mixed v2 只读且无原生预览/编辑链接。

queued/running 也可通过 `export_diagram({id,requestId,jobId})` 继续等待原任务，不重复入队；`jobId` 与 `retryJobId` 互斥，沿用原快照和 options。STDIO 固定 8MiB 序列化安全预算，`resourceLimits` 标明保守可读性；过大 SVG 返回 `MCP_RESOURCE_TOO_LARGE`，仍可继续调用工具，完整文件通过 `files.svg` 或认证 HTTP 下载。PNG 预览过大时 `previewStatus=too_large`，`exportStatus=succeeded` 与真实制品路径保留。仅预算内制品附带有 size 的 resource_link；不裁图、不替换字体以凑预算。

AI 提供内容，FlyMind 自动布局并渲染。普通绘图只提交 `content`，无需 API Key、坐标或美化配置。

绘图和修改必须遵循 [绘图内容标准 1.1](DRAWING_STANDARD.md)。`get_drawing_guide` 自动合并返回该标准；也可读取 `flymind://drawing-standard`。`validate_diagram` 返回 `valid` 和 `quality:{standardVersion,passed,score,issues}`，新建或修改不合格内容时返回 `QUALITY_FAILED`，数据库不写入。文字简洁、判断出口、业务连通性、模块/主题抽象各有规则；机器检查之外仍须核对真实业务。

修改时直接改原业务步骤、判断条件、连接或原文案，不得用说明代替流程变更。工具顶层可带 `editIntent:"structure"|"wording"|"annotation"`，默认 structure；只有用户明确要批注时使用 annotation。纯补注释或非卡片说明文字的修改会被默认拒绝，微改节点/边/容器文字也不能绕过。历史问题允许逐步修复，不能新增或加重；网页可保存手工草稿。

## 内容标准1.1的强制边界

流程/泳道只用动作/判断；架构module可有依赖箭头，不能因有箭头就当流程；脑图topic表达分类，数据流card表达来源/处理/去向。流程图需明确起终点和可达结果；泳道允许task入口与明确交付结果，不强造start/end。纯技术组件名、性能/成本预算不能伪装task。

items仅架构，badge仅架构/数据卡；其余类型不借字段藏说明。流程标题硬上限24中文/80纯外文，description120字符；架构/数据卡正文240，其他正文120。note标题80中文/240纯外文且总量200，数量max(2,ceil(业务节点×15%))；各字段和节点总预算详见唯一正式标准，不靠分字段绕过。人工网页草稿不受AI准入阻断；旧新MCP均不能新增/加重error或warning。

## 1. 两层职责

| 层 | 负责 | 不负责 |
|---|---|---|
| 内容 content | 节点内容、节点类型、连接关系、角色/阶段/分组、可选语义颜色 | 坐标、布局行、尺寸、形状、字体、图标、线型 |
| 渲染 rendering | 标准节点配置、主题、大小、形状、配色、连线类型、自动布局及手动覆盖 | 修改业务文字、角色职责、连接关系 |

内容 JSON 不包含 `presentation`、`rendering`、`updatedAt`，节点不包含 `order`。内容工具会拒绝这些字段。普通 AI 绘图也不需要写 `ranks` 或手动位置。渲染层根据关系排序、分支排布、避开同泳道节点和反馈循环、换行、撑开卡片，采用标准配色与形状。

仅当用户明确要求改变视觉表现时，读取 `get_rendering_config` 后单独调用 `configure_rendering`。业务步骤是否存在、连接到谁，不能为了美观被改变。

网页手动编辑固定已有节点几何，保存和后台同步保持画布视角；新增节点寻找附近空位。需要整体重新排布时才使用“自动布局”。正交连线可拖动线段中点整体平移，端点保持与节点相连；不把自由移动的点直接拼成斜线。文字与线条分开选择、拖动和删除，双击文字编辑，双击线路可添加文字；文字样式独立使用 `rendering.edges[id].labelColor / labelFontSize / labelPosition`。独立说明可用 `kind:"note"` 节点表达，无需连接边；其位置由渲染层管理。draw.io 导出也将分支文字作为独立文字元素。

共享存储已改用 `data/flymind.sqlite`，事务保存图形、分组、删除状态与修订历史。首次启动先备份旧 JSON，再一次性迁移，之后不回读旧文件。旧 MCP 进程必须重新连接才能使用 SQLite。网页“备份工作区”可下载一致的 SQLite 备份，原图制品另在 `data/artifacts`。

## 2. 支持的图形

### 工作区分组（图形列表）

工作区分组是文件管理元数据，不放进 `content` 或 `rendering`，也不等于架构图的 `groups`、泳道/阶段或画布组合。

1. `list_workspace_groups` 获取现有分组；需要时 `create_workspace_group({"name":"客户项目"})`，使用返回的 `group.id`。
2. `create_diagram({"content":{...},"workspaceGroupId":"返回的分组 ID"})` 可直接归入分组；省略时未分组。
3. `list_diagrams({"workspaceGroupId":"分组 ID","sortBy":"updated"})` 列出组内图形；`sortBy:"created"` 按创建时间，`workspaceGroupId:null` 筛选未分组，省略则全部。返回 `createdAt/updatedAt/workspaceGroupId` 元数据。
4. 先 `get_diagram`，再 `move_diagram_to_group({"id":"图形 ID","workspaceGroupId":"目标分组 ID 或 null","expectedWorkspaceGroupId":"刚读取的所属分组 ID 或 null"})`；实际 null 不加引号。移动不改变内容、渲染和图形 revision。
5. 分组改名或删除先读取最新分组 revision，调用 `rename_workspace_group` 或 `delete_workspace_group` 并携带 `expectedRevision`。删除分组保留图形，全部转为未分组。

网页侧栏是可折叠分组树：组内图形只在组内出现，主列表只显示未分组图形。拖入分组归组、拖至主列表移出分组。搜索跨分组；文件改名/复制/删除在右键或悬停更多菜单，排序、新建分组、备份和规则入口收在 FlyMind 菜单。创建时间精简显示，悬停可看完整创建/修改时间。

已删除图形 ID 有持久删除记录，`DELETED` 表示禁止用旧备份重建。普通删除进入回收站，用户要求恢复时先调用 `list_deleted_diagrams`，再用返回的 `revision` 和 `deletedAt` 调用 `restore_diagram`。恢复保留原 ID、创建时间、内容、渲染和原分组（分组已删除则未分组），图形 revision 加一；旧页面无法覆盖恢复后的版本。发生 `CONFLICT` 必须重新读取并合并。网页的“待恢复内容”是未同步备份，只有主动操作才创建新 ID，和回收站分开。

### 回收站

| 工具 | 输入 | 结果 |
|---|---|---|
| `list_deleted_diagrams` | 无 | 已删除图形的 id、title、kind、revision、deletedAt、createdAt、workspaceGroupId |
| `restore_diagram` | id、expectedRevision、deletedAt | 恢复原图，返回新 revision、PNG 和编辑链接 |
| `permanently_delete_diagram` | id、expectedRevision、deletedAt | 永久删除内容、修订历史和生成制品；保留 ID 删除标记，禁止旧进程重新创建 |

恢复和永久删除都必须使用刚读取的回收站记录。只有用户明确要求永久删除指定图形时，才能调用永久删除；整理、去重和普通删除不代表该授权。永久删除无法从回收站恢复；此前主动导出的备份不受影响。网页通过图形“更多 → 移入回收站”删除，在左下回收站恢复或确认永久删除。

### 独立文字

所有图形都支持 `{"id":"note-1","kind":"note","label":"说明内容"}`，可选 description、color。它是画布上的浮动文字，不是流程步骤；不需要 laneId、phaseId、groupId、parentId 或连接边，不参与依赖排序、容器尺寸和连线避让，也不改变其他节点位置。普通绘图无需补写字段或坐标。

渲染器默认使用 17px 文字、透明背景、无边框，按文本计算尺寸，旧流程节点的 width/height 不再作为文字占位。未放置的说明默认排在主图下方，网页添加时放在当前视口，可自由拖动；绘制顺序在节点和连线之上。网页支持双击编辑、复制、撤销及左右手柄调整换行宽度。样式独立保存在 `rendering.texts[id]`，支持 fontSize（10–48）、color（#RRGGBB）、width（24–4000，可省略自动宽度）；位置仍属于 `rendering.positions[id]`。AI 仅在用户要求视觉调整时读取并配置渲染层。思维导图的说明不计入根主题，也不能充当业务主题的父节点。

### 绘图类型

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
    {"id":"e4","source":"wait","target":"review","kind":"feedback"},
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

edges/lanes/phases/groups 可省略，自动补空数组。思维导图通过 parentId 自动生成连线，无需额外 edges；额外业务关联可放 edges，其 ID 不可与自动连线 parent_{子节点ID} 重复。其他图形必须显式描述连线。判断出口标注“是/否”或具体业务条件；保留循环和异常分支。

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
    {"id":"e4","source":"revise","target":"agree","kind":"feedback"},
    {"id":"e5","source":"agree","target":"done","label":"是"}
  ]
}
```

渲染器按阶段和连接关系自动推导步骤行：有先后关系的步骤逐级推进，跨角色交接也进入下一步；独立分支可同排，汇合步骤位于相关前置步骤之后，同一角色的节点避免重叠。纵向是角色列、阶段行，横向在渲染配置里切换。拖动跨泳道/阶段会改变实际业务归属，普通拖动只改渲染位置。

#### MCP 输入规则：先后、分支和回流

- 不需要为排版新增节点描述或必填字段。`description` 只写业务备注，不作为排序依据；节点数组顺序也不表示步骤先后。
- 普通边（省略 `kind` 或 `kind:"flow"`）表示 `source` 在 `target` 之前。必须写全实际前置关系，不能只按角色罗列节点。角色变化不代表并行。
- 独立分支从共同前置节点分别连出；需要汇合的步骤分别接收各分支的边。它们的同排、间距和避让由渲染器决定，不写 `order/ranks`、坐标或“第几行”。判断出口仍需写具体业务条件。
- 退回、驳回、返工、重试和返回监控等回流边显式标 `kind:"feedback"`，保留真实方向与条件。回流参与绘制，不推进主流程的步骤行；不能为压缩排版把普通前置边标为反馈。
- `phases` 数组按真实业务阶段先后排列，节点用 `phaseId` 关联。后阶段返回前阶段也应标为反馈。旧数据未标记的循环会尝试自动拆出回边，但业务含义有歧义，后续 AI 修改时需核对。
- 如果材料没有说明先后、是否独立推进、是否等待全部分支或哪条边是返工，应向用户确认该业务关系；不要用描述文字暗示排版或自行补出业务依赖。

例如 `分配 → 文书签收`、`分配 → 网申签收` 是两条独立分支，可并排；`材料 → 核对 → 撰写 → 审核 → 定稿` 是连续步骤，即使跨角色也逐级排列；`审核 → 撰写` 的驳回边标记为 `feedback`。

长文字自动撑开节点及对应泳道/步骤行；没有指定标准宽度时，会在有限范围内增宽，判断节点保持菱形比例。自动正交连线避开节点并分配通道，标签换行且避免覆盖节点/其他标签。保留完整业务文字，普通 AI 绘图仍不填写位置或排版参数。显式手动尺寸和路径优先，可能需要人工恢复自动布局后重新计算。

手动编辑后的阶段栏按节点实际几何范围计算，与右侧内容保持一致；固定位置不再重复占用自动排版空间。拖动跨阶段时使用当前阶段边界判定归属，不写估算布局行；仅缩放不会改变角色或阶段。泳道图压缩旧行号缺号产生的空行，独立说明文字不作为主流程步骤撑长阶段。表头左上角自动补齐为同色块，不新增内容节点或说明标签。

左侧阶段名称默认每行一个字，文字正向展示，字号 24；横向图的顶部阶段名称仍按栏宽换行。选中左侧阶段栏后，可拖动底部分隔线，或在渲染属性中输入“阶段高度”（横向图为阶段宽度）。改变尺寸时保留本阶段节点，后续阶段、节点、手动路径和文字随边界一起平移；最小尺寸需容纳节点与标题，后续有锁定节点时先解锁。支持保存、撤销和重做。“自动布局”同时恢复阶段自动尺寸。

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
| phases[phaseId].size | 阶段主轴尺寸（56–50000），纵向为高度、横向为宽度；独立渲染字段。用户明确要求时，通过 configure_rendering 调整，保留读取的其他配置；人工坐标保持原值提交时，由工具同步后续节点和线路，无需 AI 计算坐标 |
| objects | 画布对象配置：groups 为组合 ID → 节点 ID 数组（至少两个、不嵌套），locked 为锁定节点 ID，order 为从底到顶的节点 ID；不属于内容层 |

架构模块和数据卡片宽度随容器伸缩，标准宽高作为排布尺寸基准；长正文自动撑高。单节点 positions 可覆盖最终宽高。颜色优先级：单节点渲染覆盖 > 节点标准渲染配置 > 可选内容颜色 > 自动主题。位置优先级：手动 positions > 自动布局。端口为 top/right/bottom/left；points 为中间路径点（最多 40 个，不含端点）；手动路径优先于标准走线。自动布局清除未锁定节点的手动位置/布局行及连线端口/路径/标签位置，保留标准样式与颜色；锁定节点保持当前几何及外观。

画布组合与业务 groups 不同：业务 groups 定义架构分层，objects.groups 只让节点一起选择、移动和缩放。AI 修改锁定节点的文字、类型、归属或几何会失败；先由用户解锁，或在用户要求解锁时，通过 configure_rendering 删除对应 locked ID，再读取新 revision 修改。锁定是编辑约束，不是访问权限。完整对象与剪贴板规则见 docs/CANVAS_OBJECTS.md。

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

仅 `update_*` 操作的 `changes` 可用 JSON `null` 显式清除可选业务字段：节点的 laneId、phaseId、groupId、parentId、color、description、items、badge，边的 label、kind，以及 groups 分层的 color、kind。节点 label/kind、边 source/target、容器 label 为必填字段，不能清除。清除后存档 content 省略该字段；完整 content 和 add 操作仍不接受 null。不要输出 null 内容或坐标。清除归属还须满足图形规则，例如删除最后阶段可在同批操作中先为所有成员设置 `{"op":"update_node","id":"成员ID","changes":{"phaseId":null}}`，再执行 `{"op":"remove_container","collection":"phases","id":"最后阶段ID"}`；有其他阶段时，业务节点仍须归属有效阶段。

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
- 拖动节点吸附边缘/中心并显示辅助线，Alt 临时绕过；单节点或多选八方向整体缩放，Shift 保持比例。内部手动折点/标签随整体移动及缩放。框选/Shift 追加框选或多选，Ctrl+A 全选未锁定节点、Ctrl+D 创建副本；多选面板提供对齐与等距分布。方向键移动 1，Shift+方向键移动 10。Esc 取消手势，不写入文档；完成手势一次提交和撤销。
- Ctrl/Cmd+C/X/V 使用系统剪贴板；右键提供定位粘贴、组合/取消组合、锁定/解锁和图层顺序。复制节点保留内部连接及渲染配置，粘贴生成新 ID；输入框保留原生剪贴板行为。锁定节点不参与拖动、缩放或删除，新副本可独立编辑。
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

createdAt 是工作区及存储记录的独立元数据，MCP 同时返回 createdAt / updatedAt。0.6.0 起列表默认最近修改在前，也可选择最近创建。编辑和渲染不改变创建时间；新建、复制及导入生成新时间。旧图优先从 r1 工作区制品的创建/保存时间恢复，缺失时以文件历史时间估算并固定保存，不改变原 revision、savedAt 或业务内容。不要把时间写进 content 或 rendering。

每次导出创建 `data/artifacts/{diagramId}/r{revision}/exports/{exportId}/` 独立副本，文件名为“图形标题_YYYYMMDD-HHmmss-SSS.格式”。交付元数据返回 `exportedAt`，文件修改时间使用本次导出时间；文件系统能按新导出时间查找，旧导出保留。JSON 内容仍是纯业务内容，工作区 JSON 保留原 `createdAt/updatedAt`；导出不改系统内的创建时间、修改时间、revision 或排序。旧版 r{revision}/diagram.* 继续作为兼容制品保存。

编辑链接仅本机使用。可在 Codex 回复中引用返回的 files.png 绝对路径展示图形，再给出编辑/下载链接。

MCP 制品结果同时提供 resources URI；可通过 resources/read 读取 `flymind://exports/{diagramId}/{revision}/{exportId}/{format}`（png/svg/json/project.json/drawio）；旧 `flymind://artifacts/{diagramId}/{revision}/{format}` 兼容保留。PNG 使用 base64 blob，其余返回文本；只读取已生成制品。成功结果有 structuredContent 和 outputSchema；执行错误以 isError 和 JSON 文本 `{error:{code,message,currentRevision?,quality?}}` 返回。QUALITY_FAILED 按具体节点/边修正内容，CONFLICT 重新读取和合并，禁止强制覆盖。字段 schema 校验失败由 SDK 返回错误，不保证同一业务错误格式。

无 MCP 的独立渲染：`npm run render -- examples/swimlane.json output/swimlane.svg`；也可输入完整工作区文件以保留手动样式。这条命令不写入共享工作区。连接 Codex 见 `docs/CODEX_SETUP.md`。
