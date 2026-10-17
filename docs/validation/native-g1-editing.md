# G1-A 真实画布手势 helper

日期：2026-10-16。状态：G1 指定真实手势与局部路由范围已由 PM 验收。最终独立全链11项、证据与限制见 [验收台账](../DEVELOPMENT_TRACKER.md#g1-项目经理最终验收)；本报告的前序失败记录保留供追溯。

## 归属与调用

仅新增 `scripts/probes/helpers/native-editor.mjs`、`g1-ui-scenario.mjs` 及本报告。B独占 `native-g1.mjs` 编排、Runtime/STDIO生命周期、真实两轮MCP patch、临时库与制品输出。helper不创建/关闭Runtime，不写库，不直接调用引擎patch或normalize，不通过XML注入代替手势，不访问draw.io内部graph。

```js
const editor = await prepareG1UI({page,baseURL,diagramId,readRecord,outputDir});
const human1 = await round1Human(editor);
// B: actual MCP patch #1 + explicit UI re-read at this requested boundary
const human2 = await round2Human(editor);
// B: actual MCP patch #2 using human2.copy/edges returned stable business IDs
```

readRecord是无参数异步函数，返回该diagram的 `{document:DrawingProjectV3,revision,...}`。所有cell/business ID、布局签名从已保存API记录的XML只读投影取得。`baseURL`用于严格定位同源native iframe；不在helper发送凭据/外部消息。

- `prepareG1UI`：等待真实iframe，安装被动同源source验证的保存事件观察器，直接使用观测到的原生工具栏缩放输入框选择50%用于实际手势，Ctrl+S取得公开scale，不额外fit。
- `round1Human(editor,{editedNodeId='n02',anchorNodeId='n06',label='指定统筹负责人'})`：改短文案、移动/缩放n02，再移动n06作为两次AI均不涉及的人工几何锚。
- `round2Human(editor,{sourceNodeId='g1-test-step',incomingNodeId='n02',outgoingNodeId='n03',laneId='r02',phaseId='p02'})`：Ctrl+D并用原生文字编辑改为“测试副本”，拖放到明确原生交叉容器，通过原生悬停连接箭头实际创建入/出边；另复制“临时删除测试”后真实Delete。返回copy/deletedTemporary/edges的实际businessId和cellId。
- B的AI1：新增明确技术测试步骤g1-test-step，重连现有n02→n03边并串接到n03；AI2根据最新读取删除测试副本/测试步骤和关联边，并还原原边。不推断PBS缺失条件，不把新增测试演练当真实业务修补。

基础editor提供 `editLabel({nodeId,label,save:false})`、`requestSave()`，方便B在同MCP远端修改后发起真实旧UI保存、等待409/读取IDB；helper不会自动覆盖远端或把冲突当正常保存。另有 `moveResize/duplicateInto/connect/deleteSelection/select/snapshot/viewEvidence/screenshot`。

## 证据与判断

saveAndRead以动作前API revision为基线，通过真实Ctrl+S并轮询最新API revision/实际内容；不以固定sleep或仅收到save消息认定落库。另比较Ctrl+S前后原生DOM滚动、SVG变换及选择句柄，若ack改变视角/选择则直接失败。

snapshot包含actual cellId、businessId、parent、端点、完整mxGeometry子树（含人工折点）、style及布局签名；规范化省略的数值0不影响x/y/relative比较。`assertCellsPreserved`明确要求两侧cell存在且签名相等，不能以两侧缺失误过。无关锚n06及B选定的不受影响边/装饰应在两次MCP修改前后各比较一次。

布局动作使用实际DOM label校准公开save scale和原生几何，只读XML用于定位容器和验证结果；拖放、缩放、复制、连接、删除都走真实Playwright鼠标/键盘。找不到唯一label、正确resize handle、公开scale或明确交叉容器则失败，不猜测成功。

## 验证状态与限制

- 已执行两个helper的 `node --check`，通过；尚未由A启动任何浏览器/Runtime或跑整套昂贵probe，按PM要求交B一次组合再窄修。
- 固定31.5.3 DOM适配依赖 `.geDiagramContainer/.mxCellEditor`、原生悬停箭头和可定位短文案；同名多业务节点不静默选第一个。
- 节点缩放是实际resize，不是浏览器CSS变换；准备时通过原生缩放输入框选50%保证拖动跨过像素阈值。显式人工滚动/定位与保存ack导致的非预期跳动分开记录。
- 原始PBS 23节点/26边、38分来源问题保持。最终删除测试对象后应恢复23/26，质量问题不得加重，不把旧图38分当新建合格。
- PM要求执行阶段右侧“未领取/超时中间/当前目标未完成”等回流标签纳入最终PNG/SVG及局部截图复核。技术投影通过不证明标签无重叠；若重现需用保存XML的边/折点/标签几何及截图定位，先交PM确定引擎窄修范围，不擅自全图重排。

### 首次组合反馈与窄修

B首次组合（`output/playwright/native-g1`）在r2后移动超时：短文案已真实保存，但fit仅25%，小位移接近引擎拖动阈值，截图显示容器/交叉格选择句柄。未增加timeout或降低断言，未修改产品/引擎：

1. 初始手势比例改原生toolbar缩放输入框50%。
2. 业务节点选择使用Escape清选择，再Ctrl+Alt真实点击目标label（固定原生嵌套直选手势）。
3. 移动点改为目标label自身DOM boundingBox中心；resize必须找到该节点右下角附近真实可见native handle再鼠标拖动，不能只按估计角点冒充成功。
4. 已通知B使用其`--round1-only`组合mode定位，不另建Runtime或重复整套昂贵探针。

只读签名自检使用首次失败保存记录，通过：23内容节点（20 native node + 3 annotation）、26边，缺失cell明确拒绝。初版自检错误地只计native node得到20，随后按内容层包含annotation的定义纠正自检；未更改来源或业务。

B后续round1-only两次定位仅止于缩放控件：首次假定.geToolbar，改祖先后仍因控件不是text失败；实际`failure-toolbar.html`已确认 `<input class="geButton geZoomInput" type="text">`。最终只使用此观测DOM：fill百分比+Enter，核对inputValue，再点击画布空白取得焦点/Ctrl+S，必须观察公开save.scale确实改变。未改产品toolbar或放宽阈值。

为避免50%长图的round2目标落在屏外，round2开始显式通过同一原生输入框改25%总览（记录为人工缩放动作，不是保存ack重置）。可选`inspectDenseRegion`显式100%并真实scrollIntoView，返回截图及DOM文字框/SVG path d/几何签名供PM复核执行密集区；它只收集证据，不据此宣称无重叠。

### 移动未生效继续定位（未认定通过）

50%截图后续显示n02本身可被选取，不能继续沿用首轮“容器误选”结论。API仍r2、n02几何x50/y246/w260/h64，故未将鼠标轨迹或旧D03 realPointerDrag旗标当作真实移动证据。

只读固定Graph.js核对：isTableCell(16412)/isTableRow按父结构判断，isTable按childLayout=tableLayout(16430)。node→intersection(swimlane无childLayout)→phase(tableRow无childLayout)→table(tableLayout)中，业务node不是tableCell/row；isCellMovable(18858)、isCellResizable(22639)、getCompositeParent(9630)未静态禁止该node，失败XML也无movable=0/祖先locked=1。selectCellForEvent及getInitialCellForEvent存在原生选择传播，Ctrl+Alt为toggle，不能假定Escape已清选择。

冻结版窄修：真实点击画布空白清选择，再Ctrl+Alt点目标，必须至少3个native角句柄与业务几何匹配；R1改n02向左40/向下40model（50%为20/20px）以越过grid/guide阈值，向左为后续resize留出原lane空间。拖动从节点非文字body开始，记录elementFromPoint命中及其DOM；每次原生Ctrl+S只读公开save.xml验证本地x/y确变，再等待API revision。首次本地无变化时仅在同页另一个body+Alt手势重试一次；两次仍不动立即带pointer/before-after geo失败，不延长等待或降低断言。固定源码mainHandle是18×18 SVG image（Graph.js28074），因此可见角句柄候选含image/ellipse/rect的真实bbox，而非只找rect。

缩放时序继续按真实反馈窄修：Enter后立即读input曾出现25%回写（尚未发生业务动作）。最终省略非必要initialFit，先等公开save.scale=目标比例，再断言inputValue，不把Enter后的瞬间值当最终提交。源码createZoomInput已只读核对：原生keydown Enter通过parseInt(value)/100执行zoomTo，SCALE/blur事件更新输入值；helper只操作这个可见控件，不直接调用zoomTo内部API。

### 实际live DOM裁决：角控点隐藏，改用原生侧控点

B已保留同一Runtime/page并提供`native-g1-round1/interactive-1-canvas.html`。实际DOM证明n02选中：blue dashed rect与130×32px业务box匹配；`nw/ne/sw/se-resize`的g为display:none，`n/w/e/s-resize` image可见、控点外扩12px。这是native manageSizers行为，不能把圆点一概认成hover连接箭头，也不能要求不存在的角控点。

最终选择校验改为业务bbox匹配的真实虚线框+DOM cursor明确E/S resize控点；节点resize分别拖实际E、S image控点。每个手势返回cursor、真实page bbox及公开保存XML本地几何；仍要求API修订和实际width/height变化。B在同一个live page热载入helper窄重试，不为这一定位再建库/导出。本节替代前述“三角匹配才算选中”的初版假设，保留失败历史用于追溯。

### Round1真实窄跑通过（B同页重试）

`node --import tsx scripts/probes/native-g1.mjs --round1-only` 最终通过，`output/playwright/native-g1-round1/result.json` 为ok=true，graceful-exited/tempCleaned。live retry先真实恢复原文案再完整执行R1，不把同文案no-op当编辑通过。证据`ui-round1.json/.project.json/.drawio/.png`，最终r8：

| 业务节点 | 初始x/y/w/h | 实际保存x/y/w/h |
| --- | --- | --- |
| n02 | 50/246/260/64 | 8/286/292/80 |
| n06人工锚 | 50/206/260/64 | 18/230/260/64 |

n02 pointerTarget为实际有fill/stroke的业务rect；首次body drag即使公开保存XML的x/y改变，无需Alt重试。E控点16px拖动后宽260→292，S控点8px后高64→80，已由API记录确认。全部保存ack视口/选区DOM不变。helper现冻结，B继续fresh完整链及R2/MCP交替，尚不据R1独立通过宣称G1通过。

## G1只读视觉复核（待PM裁决修复）

未开新Runtime/浏览器。复看D04 `output/playwright/project-manager-d04/pbs-native.png`、原生`drawio-renderer/cold-pbs.svg/.drawio`与B实际MCP AI1 `native-g1/ai-round1.png/.drawio`，并只读其临时导出SVG。PNG都是1965×3029；不是拿25%编辑器预览判最终可读性。

证据：`output/playwright/native-g1-visual/{d04,ai1}-execution.png`为原PNG像素裁剪(x830..1650,y1490..1840)，`{d04,ai1}-assignment.png`裁剪(x150..920,y380..790)；`routes-and-labels.json`从真实SVG按data-cell-id提取path/label位置，无重绘/重导出。下列坐标是该真实SVG/PNG坐标系。

| 区域/对象 | 具体事实与判断 | 归因 |
| --- | --- | --- |
| AI1 e02“必选指派”与n16 | e02字基线(347,580)，n16正文同区域约(348,582)，确实叠字；e02横段y593.85穿n16框，不是小比例显拥挤。 | AI1将e02 target n03→g1-test-step，却保留旧右出/左入anchor及offset(0,-18)。 |
| 人工n02与e03“可选安排” | 人工n02下移+增高后e03字基线(348,502)落入n02底部(至513.85)，但与n02正文基线相差约24px，属于标签压进框底部，不是正文同基线叠字。 | R1人工缩短n02→n16净间距，UI1已成立；e03 XML在D04/UI1/AI1未改，不能归咎于AI新增步骤。 |
| 执行区e12/e17 | “未领取或执行中退回”中心y1653、“当前目标流程已完成”中心y1665，13px字体1.2行高15.6px，两行框重叠约3.6px；原PNG仍能辨两行，但间距真实不足，不能称只是25%拥挤。 | D04和AI1该区path/标签完全一致，是已有渲染问题。 |
| 执行区e16/e17公共竖轨 | 均沿x1248.64，e16从y1601.85至1913.85；它在e12标签后绘制，穿过e12字框(约x1181..1316,y1645..1661)。 | 原生路由叠轨且后画edge可压前画标签。 |
| e16“平台订单：单份文书已完成” | 标签中心(1249,1740)，宽约174，左部进入n11框右上缘；与n11主文字分成上下两行，未发现同基线正文叠字，但标签/边框侵占真实存在。 | 旧模板标签偏移/公共竖轨。 |
| e13上方“调整后重新领取” | 中心y1542，和其他标签有明显垂直间隔；不是整片所有标签都叠字。 | 总览缩放会显拥挤，不能一概报严重重叠。 |

AI1 e02原生路径：`M468.5,473.85 L500.64,473.85 L500.64,593.85 L186.36,593.85 L186.36,705.85 L209.32,705.85`。D04路径则从(478.5,425.85)沿x528.36到(569.32,729.85)，标签基线(528,565)，在n16右侧空隙。UI1保留e02端点n02→n03、样式和offset；AI1仅改变端点后出现折返穿框/字叠字，可定位为受影响边未更新原生端口/标签位置。

### 最小建议（未实施，等待PM授权）

1. 只在结构patch真正改变端点的受影响edge重新选择原生端口/标签偏移。当前e02同角色跨过中间n16，使用native右出→右入的外侧回路，让原生orthogonal router生成路径；标签向该空白外侧偏移至少半标签宽+间隙，避免复用旧(0,-18)把标签放进中间节点。仅动e02 routing相关style与label geometry，不能重编译或改无关节点/边折点/样式；回退e02时再次按新端点计算。还需真实PNG验证，当前只是具体候选，未声称已可读。
2. R1人工动作造成的e03压框可由明确人工动作在同一UI把n02纵向位移改为20model（横向仍40model），保留至少52model净间距；或明确人工拖动e03标签。不能让AI1偷偷改无关e03以美化。
3. D04执行区单列为模板/既有图质量项：优先仅给e12/e17分离的label offset，确保行中心间距≥24px并横向避开x1248.64公共竖轨；e16标签向r04空白侧平移使其左边不压n11框。是否也调整e15穿n09框的native端口需PM另划范围，不能借本次e02窄修全图重排。纯移动标签不足以声称解决全部路径交叠。

## G1路由窄修交验（2026-10-16，代码冻结、待PM验收）

以上“最小建议”为当时只读结论；PM随后批准使用固定供应的libavoid共享计算核进行窄修，实际实施如下：

- 首次compile：只计算边，不改业务节点/容器布局。当前全部业务node（含浮动注释）作为障碍，固定`shapeBufferDistance=16`、`idealNudgingDistance=14`；生成原生orthogonalEdgeStyle及原生mxGeometry折点。反馈边依然不参与主排序，PBS业务23节点/26边不修补。
- 结构patch：仅新增或端点变更edge重新路由。清除这些edge过期entry/exit/port/waypoints/label offset约束，保留文字、paint；锁判断沿用已有机制。所有其他cell，包括人工节点/旧edge折点/装饰，保持完整签名。label-only不重新走线。
- 标签槽按fontSize、labelWidth、实际文本估计行数和1.2行高选择，避开节点框、当前路段和已安排标签。patch还把无关旧edge的原生geometry/端点/label x/y/offset作为只读保守占位；不移动它们。不硬编码PBS业务ID。
- 输入预算与内容schema一致：500nodes/2000edges；无安全路由/标签槽明确报错，不退回穿框路径。
- 自环不交给会跳过selfloop的libavoid核：使用固定draw.io原生`loopEdgeStyle;orthogonal=1;orthogonalLoop=0;segment=...;direction=...`，周围包络只用于选安全方向/标签，不存手写loop折点。先前“两个固定锚+orthogonalLoop”的真实PNG只画短边，已由实际PNG发现并修正，最终不是以估算包络冒充通过。
- 新geometry按固定codec输出offset在Array之前；首轮真实renderer曾因子元素顺序变化报`NATIVE_DOCUMENT_CHANGED`，精准diff后只改新geometry顺序。renderer严格签名门槛未放宽、无全局浮点容差。
- R1明确人工测试动作n02纵向改20model，防止原dy40把e03标签挤进框；未让后续AI偷改无关e03。`native-editor.mjs`连线窄修由B接管，A不再并发修改。

### 供应与加载

复用本项目固定31.5.3官方供应`resources/drawio/vendor/js/libavoid-js/`：

| 文件 | SHA256 |
| --- | --- |
| libavoid.min.js（572189bytes） | `1c963a8f53b464a87c2fba3dc304a720d924fdcda4737cfd950e33f6a4c41c1d` |
| libavoid-routing.js（25842bytes） | `9327d57d3c4f3fa04fc1eeb91d7da045c2b1a2ba87df681e029145d3ee2f04b6` |
| LICENSE（26527bytes，LGPL2.1） | `6da7ddf40cfea6f568961825b14478e879875f6ad033fad57889ae5bd52103f4` |

来源为已核验官方WAR（SHA256 `6c4ab25145c3479bf0097e4fccd20c602968615986bc999af8a214719fabd3f4`），无vendor修改/新依赖/CDN。初始化先核验本地三个哈希、await实际`__libavoidReady`，然后使用官方共享`AvoidRouting.computeRoutes`，finally释放本任务Router（幂等delete）。API smoke记录created/released均1。许可文本保留；正式分发义务仍V04待核，不宣称许可审查完成。

Node loader独立在`routing-node.ts`，仅需新路由时延迟装载；共享投影入口没有顶层Node fs导入。浏览器加载分支仅同源`/drawio/js/libavoid-js/`并校验哈希；本轮实际求解在Node，Vue构建通过，不把未跑的浏览器侧编译称为真实验证。

### 文件、命令与实际结果

文件：新`src/drawing/engine/drawio/{routing.ts,routing-node.ts,routing-supply.ts}`；`index.ts`首次compile调用、`patch.ts`受影响edge调用；`tests/drawio-engine.test.ts`新增3项；`scripts/probes/g1-routing-{smoke,renderer}.mjs`；`helpers/g1-ui-scenario.mjs`仅R1 dy20；本报告。

1. `node scripts/probes/g1-routing-smoke.mjs`：固定哈希、实际ready/computeRoutes、绕中间障碍、原生对象释放通过，证据`output/playwright/native-g1-routing/api-smoke.json`。
2. `node --import tsx --test tests/drawio-engine.test.ts tests/drawio-editing.test.ts`：32/32，含原29项及2000selfloops/端点路由清理和paint+无关cell保留/新标签避旧标签占位。日志`engine-final.log`。
3. `npm run build`：vue-tsc、server tsc、Vite通过，日志`build.log`。
4. `node --import tsx scripts/probes/g1-routing-renderer.mjs`：独立renderer，无用户DB/Web Runtime。sandbox首次localhost DENIED后同命令获审批，最终3样本全通过，证据`render-report.json`和各`*.input.drawio/*.captured.drawio/*.drawio/*.svg/*.png`，均在`output/playwright/native-g1-routing/`。

| 真实样本 | 实际尺寸 | 最终本轮耗时 | 核验 |
| --- | --- | --- | --- |
| fresh-pbs | 1965×3029 | 4134ms | 首次PBS重路由，内容不变、native load/save全签名一致；执行区原紧邻标签分槽、共轨穿字改善。 |
| patched-e02 | 1965×3029 | 3812ms | 读取B真实人工UI1 checkpoint后增测试步骤、e02重连及后继边；88旧cell全签名保留。n16穿框/叠字消除，旧执行区保持不动。 |
| native-loop | 539×481 | 3514ms | 实际SVG路径`M478 218 L510 218 L510 250 L487.18 250`为完整原生U形；无斜线、未穿邻接业务框，PNG已实际打开检查。 |

三个样本均通过原生保存后project内容hash和drawioRenderSignature严格相等。A实际打开三个PNG；PM也已独立目视fresh/patched，具体是否通过由PM判定。

### 边界与剩余项

旧人工图的无关密集执行区不会因一次e02重连自动美化；patched样本保留旧e12/e17拥挤属本次保留要求，不能称全图无重叠。只读旧标签估计是保守占位而非完整draw.io排版器，遇无槽明确失败；当前未承诺任意复杂图的最优线交叉或标签关联美观。首次compile可重算全部生成边，既有图patch禁止全局重排。

三样本用既有真实UI1（原dy40）的快照验证局部保留；它不替代B即将fresh执行的dy20两轮真实手势/MCP交替。B已确认R2精确源箭头/目标内部body及公开XML端点断言通过，完整fresh链仍由B编排；A本报告不自行宣称G1通过。代码已冻结，等待PM独立回归/build/三样本及B组合结果。
