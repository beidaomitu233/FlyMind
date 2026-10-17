# D02-A 原生泳道编译、投影与局部修改

日期：2026-10-16。开发状态：待项目经理验收。本记录仅覆盖 D02-A，不代表 D03、D04 或 G1 通过。当前应用版本不变，未提交、推送或访问生产数据库。

## 实际交付

入口 `src/drawing/engine/drawio/index.ts` 已提供共享契约要求的三个异步函数：

```ts
compileDrawio(content: DiagramContent, options?: DrawioCompileOptions): Promise<DrawioEngineDocument>
projectDrawio(xml: string, baseContent?: DiagramContent): Promise<DrawioProjectionResult>
patchDrawio(base: DrawingProjectV3, operations: DiagramOperation[]): Promise<DrawioEngineDocument>
```

版本和 profile 直接使用 `engine/constants.ts`：draw.io 31.5.3、adapter 1、swimlane-standard v1；内容规范化调用 `validateContent`，SHA-256 调用另一开发代理提供的 `contentHash`。没有改共享契约、项目校验、业务模型、存储、UI 或原夹具。

编译器生成可编辑原生 mxCell/UserObject，而非图片。原生结构为 tableLayout → 阶段 tableRow → 角色/阶段交叉 swimlane 容器；角色表头是第一行原生单元格。业务节点只有一个 parent，fmLaneId/fmPhaseId 与交叉容器归属一致才允许投影。首次角色列/阶段行编排复用 `swimlaneRanks` 业务依赖策略；明确 feedback 不参与主排序，存量未标反馈的循环保持原语义，不补边、不改类型。线路由本地引擎 `orthogonalEdgeStyle`、原生侧端口和 jettySize 处理，编译器没有自造线路折点或调用旧 layoutDocument/renderDrawio/renderScene。本模板没有使用新安装的 ELK 来另建通用布局器。

阶段名称由受控原生文本子 cell 显示，24px 字体、32.8px 参考行高、窄文字框自然逐字换行，字形正向；不往 content.label 插入显示换行。阶段主对象维持业务绑定，投影和局部改名读取/更新受控 title 子元素。角标“阶段 / 角色”为正向横排。角色标题背景采用实际生效的 partialRectangle 填充，PNG 默认白背景。

业务 ID 和 cell ID 分命名空间，包括夹具中节点 `p02`/阶段 `p02`、节点 `p04`/阶段 `p04`。每个主绑定通过局部 fmIndex 保存原数组序列，独立回读和原生保存后回读都不依赖 XML 层级遍历顺序。fmIndex 是文档绑定信息，不是内容接口可输入的布局行。

文档身份和 profile 存在可见标题 UserObject 的局部属性中。实测原生保存会丢弃 mxGraphModel 的自定义属性，因此投影不依赖根属性保留，也没有在根元数据中藏完整 content。description/items/badge/color/parentId/groupId 等未直接编辑属性放在对应业务 UserObject 的属性中，按字段投影；不从视觉 fill 反推语义 color。

## 已支持和明确边界

| 范围 | 本次行为 |
|---|---|
| 图形和模板 | 仅 swimlane；角色列、阶段行。其他 kind、额外业务 groups、水平模板、未知 profile、legacyRendering 显式拒绝。未宣称五类完成或迁移可用。 |
| 输入约束 | 普通 content 仍通过 validateContent 严格拒绝坐标、字体、形状、线型等视觉字段。编译偏好只接受共享字段，未知字段拒绝。 |
| 偏好 | blue/indigo/forest；节点 width/height/fontSize/shape/fill/stroke/textColor。节点宽度最小64，上限2000，标准高度32–2000、字号10–48；正文需要时初次编译扩高。显式 fill 优先于语义 color，语义 color 本身不变。 |
| note 标准 | 浮动文本支持 width/height/fontSize/fill/stroke/textColor，宽度同为64–2000；note.shape 显式拒绝。注释框按正文扩高，独立注释轨避开前一注释，不拉长主流程阶段；无 lane/phase 的合法 note 也能独立保留。 |
| 连线标准 | 当前只接受 orthogonal；width/color/dashed 和 arrow=end/both/none 均映射到原生样式。straight/curved 显式拒绝。边标签有明确 labelWidth，允许原生拖动；默认偏移不改变业务标签。 |
| 投影 | 可见图标题、角色名、阶段名、节点文字、边条件/端点和明确归属；可选字段缺省状态保留。HTML 标签只解码为惰性纯文本，不执行脚本。 |
| 装饰 | 普通新增无绑定 shape 保留在 XML，返回 DECORATION_PRESERVED 信息诊断，不能直接当作新业务节点。diagnostics 非空不自动代表结构失败。 |
| 归属不一致 | 改 fmLaneId/fmPhaseId 却未移入匹配原生交叉容器，或交叉格与阶段行不符，抛 OWNERSHIP_MISMATCH。D03 需要在原生拖动/新增的集成层建立明确归属交互，不把当前投影称作已支持任意跨列拖动。 |
| 局部 patch | set_title；update_node 的 label/description/items/badge；update_edge 的 label；update_container 的角色/阶段 label。保留全体原生几何、手工折点、样式及未知装饰。结构性新增/删除/重连 patch、其他字段和渲染操作当前显式拒绝。 |
| patch 保持范围 | 基础修订内容/Hash/XML 必须一致；修改当前对象或其祖先 locked=1/editable=0 时拒绝，包括只改 description/items/badge。当前不做文案 patch 的自动扩容；过长替换后的可用布局仍需后续受影响范围策略验证。 |

## XML 安全和结构校验

`drawio/xml.ts` 使用 @xmldom/xmldom 0.8.15 解析及转义，限制 UTF-8 5 MiB、10000 cell、结构深度128及总元素数量。拒绝 DTD/实体声明、非法控制字符、非标准处理指令、主动 XML 元素、解析警告/错误、多页、压缩页及混入压缩文本。仅处理单页未压缩 mxfile/mxGraphModel。

cell ID 重复、同类业务 ID 重复主绑定、坏 parent/source/target、parent 循环、业务边连装饰、缺少业务身份、错误绑定版本、受控阶段标题重复或脱离主容器，以及 node/annotation 类型矛盾均拒绝。复制业务元素携带重复 fmId 目前报错，不静默覆盖；D03 才建立副本新 ID 和内部引用重映射。

## 实际自动验证

`tests/drawio-engine.test.ts` **14/14 通过**，覆盖：PBS 23节点/26边原样往返与业务/阶段同名 ID；普通泳道；可选字段和字面 XML 转义；可见标题/角色/阶段/节点/边条件与端点修改；明确归属及错误归属；未知装饰；AI视觉字段拒绝；XML攻击、过大、压缩、多页和 malformed；重复cell/业务绑定、坏引用/parent循环；局部 patch 保留全部 cell 属性/几何/人工路径/装饰；旧内容/Hash不一致；节点及祖先锁（含 metadata-only）；长标题/长批注；乱序全部数组无base独立回读；箭头和fill优先级；note标准应用及不支持shape拒绝。

以下命令已实际执行并通过：

```powershell
node --import tsx --test tests/drawio-engine.test.ts
npx --no-install vue-tsc --noEmit
node --check scripts/probes/drawio-engine-browser.mjs
```

引擎测试日志：`output/playwright/drawio-engine/test.log`。项目经理已将新引擎/项目测试纳入默认 npm test；本子任务没有越权修改 package.json。完整回归与最终验收由项目经理独立执行。

## 真实本地编辑器证据

复用 D01 的现有 Chrome 155.0.8059.80 和宿主 Playwright 1.62.1，独立随机回环端口，无外联。原始夹具只读。三个样本均按顺序运行：

1. compileDrawio 生成原生 XML，发送公开嵌入 load，等待真实 load 事件及可见业务文字。
2. 等待字体就绪，原生 Ctrl+Shift+H 显示全图，保存编辑器截图。
3. 原生 Ctrl+S，收取真实 save XML；分别有 base 和无 base 投影，规范化内容及 Hash 与输入完全等价。
4. 用该真实原生保存快照分别导出 PNG/SVG，校验消息关联，写入制品。
5. 对真实保存 XML 执行局部文案 patch，逐 cell 比较规范化几何不变。

| 样本 | 内容 | 原生保存/独立回读 | PNG尺寸 | SVG bytes | PNG bytes |
|---|---|---|---|---:|---:|
| pbs-main | 23节点、26边、4角色、5阶段、3note；来源异常不修正 | 均等价 | 1949×3013 | 102180 | 324433 |
| swimlane | 18节点、20边、4角色、5阶段 | 均等价 | 1602×3025 | 83829 | 257388 |
| long-text | 基础泳道派生：160字标题、长任务/判断文字、500字浮动note，19节点/20边 | 均等价 | 2129×3761 | 91998 | 554689 |

三样本原生保存前后实际几何变化数量均为 **0**。比较忽略 XML 空白/属性顺序及省略的数字0，保留坐标、尺寸、relative和子几何的真实数值；原先按XML序列比较会把纯格式变化误报为全部元素变化，已修正探针。native save 会移除根自定义属性并添加标准视口属性，业务 UserObject及其属性保留。

最终探针 `browser.json` 为 ok=true，外部请求0、浏览器请求失败0、页面异常0。仍有本地 `/drawio/null` 一次404，与 D01 相同，不影响以上链路。没有将它隐藏为完全无请求问题。

开发代理已实际打开 PBS 全图 PNG、编辑器截图及长文字 PNG：修复初次白字无底表头、透明背景、逐字竖排边标签和旋转阶段标题；最终角色标题可读，阶段正向逐字，160字标题与500字note有独立空间且正文保留。密集执行阶段仍有少量线路/标签交叠风险；不宣称全图无重叠或通过业务质量门槛，留待 G1 两轮人工/AI 编辑及 D09 样本质量评审复核。此处已有的业务矛盾/未标反馈循环保持原样。

复现命令：

```powershell
$env:DRAWIO_PROBE_PLAYWRIGHT='C:\Users\12062\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright\index.mjs'
$env:DRAWIO_PROBE_BROWSER='C:\Program Files\Google\Chrome\Application\chrome.exe'
node --import tsx scripts/probes/drawio-engine-browser.mjs
```

输出目录：`output/playwright/drawio-engine/`（忽略）。`browser.json` 为机器证据；每个样本有原始 `.drawio`、`-native-saved.drawio`、`-patched.drawio`、`-editor.png`、`.png`、`.svg`。探针没有通过内部 model API 伪造保存事件。Windows 沙箱可能拒绝浏览器回环访问，实际成功运行使用自动审核允许的外层环境，仍拦截所有非本机请求并在结束时关闭自己的服务器。

## 剩余工作和验收请求

请求验收本任务允许路径中的编译器/投影/基础文字 patch、14项测试及三样本真实编辑器证据。D01 的官方原包证明、字体分发和固定Chromium供应未因本任务解决；当前仍用机器系统 Microsoft YaHei。未实现 D03 消息会话/保存队列/恢复、原生业务新增/副本ID生成、结构 patch、全局碰撞避免、长文案局部扩容或 D04 正式后台worker。profile能力校验目前编译和项目组合两处分别约束，D03 可由项目经理协调抽成独立共享模块，避免以后不同步。
