# D07-A 引擎分批核验（进行中）

2026-10-16，固定复用dev_engine。PM已授权引擎/templates/configure/迁移及必要renderer窄适配；B独占服务/store/routes/MCP/UI接线。本文记录开发证据，不宣称D07通过。

## 已落共享契约

- `engine/profiles.ts`：`defaultProfileForKind(kind)`、`drawioCapabilities()`。现仅已验swimlane vertical的compile/project/patch/migrate为true；configure及其他4型仍false。静态profile名字存在不等于实现声明。
- `engine/types.ts`：`DrawioRenderingChanges=Partial<RenderingConfig>&{relayout?:boolean}`，`DrawioConfigureResult={profile,preferences,engine,diagnostics}`。后续从drawio/index导出`configureDrawio(base,changes)`，当前尚未实现，B不可调用占位方法。
- `engine/rebind.ts`：`rebindDrawingProject(project,newId)`已实现且可用。仅改顶层content.id、可见标题文档metadata、hash；保留内部业务/cell IDs、几何、样式、关系、装饰和源时间。B正式导入另处理落库时间/身份/CAS。
- `migration/index.ts`：通用`previewLegacyMigration/convertLegacyMigration`已导出，同D06契约，当前仅swimlane可转换，其他kind明确blocked，后续按型扩展。

## 底座第一组（已自测，尚非全部模板）

`drawio/controlled.ts`提供受控title/body/item/badge原生可编辑文本子树；主形状`fmFields`仅声明局部字段槽与items数量，未藏完整content。严格投影从可见子元素取值，缺失/重复/错owner拒绝，条目按局部fmItemIndex保持数组顺序。normalize依据真实主祖先为复制子树重绑新业务身份，保存A确认元数据按原cell身份先恢复再检查锁。patch已可实际修改已存在受控子树的正文/条目/badge并在目标节点局部扩高。

兼容旧swimlane1/G1：原compile当前未自动改变旧单形状节点，受控底座由后续模板接入；本组不宣称新建模板全部字段已就绪。icon/edge-label角色目前明确拒绝，后续批次实现后再启用。

验证：

- `node --import tsx --test tests/drawio-rebind.test.ts`：2/2；实际完整业务项目重绑内部cell全签名保留。
- `node --import tsx --test tests/drawio-controlled.test.ts`：4/4；可见正文/条目/badge/note.description、native文本编辑投影、子树复制、缺失/重复/顺序、AI正文条目实际修改及另一node子树签名不变。
- 原engine/editing32项与rebind合跑34/34；server tsc通过。未重跑全套。
- `node --import tsx scripts/probes/drawio-controlled-native.mjs`：固定Chromium/完整draw.io真实打开保存+PNG/SVG，两快照（visible-fields、ai-actual-fields）均严格内容hash/renderSignature不变。尺寸945×937，4133/3825ms；A实际打开两个PNG，标题/正文/两项→三项/badge/浮动说明正文均可见。

真实组产物`output/playwright/drawio-controlled/{report.json,visible-fields.*,ai-actual-fields.*}`。该probe用现有泳道grammar+受控builder及明确rendering尺寸标准验证底座，不冒称五型模板或人工双击编辑已完成。未用XML注入冒充真人手势。

## 接下来（已获授权，继续无需逐函数请示）

按PM最新指示：完成可见底座后继续四新型、泳道闭合、configure/各型迁移；每可审类型/配置批次给冻结证据，由PM集中独立运行。先补受控icon/edge-label和复杂字段的模板尺寸计算，再推进flowchart/architecture、mindmap/dataflow；使用固定ELK/libavoid/native形状，不扩自研白板。显式产品边界或共享契约变化才报PM裁决。新capabilities只能在对应真实证据后启用。

## D07 第二检查点（开发中，未开放全能力）

- 四新型首次编译/严格投影已落 `drawio/generic.ts`，固定ELK0.9.3与已固定libavoid；增量变更在`generic-patch.ts`，不调用首次ELK。当前公开能力矩阵仍只启用已验收旧泳道，configure尚未开放。
- `node`/`annotation`复杂字段已自动物化原生title/body/item/badge，普通短标题仍保留主cell；控制清单只描述字段，不存完整content。受控子树复制/删除、缺失/重复、迟到元数据确认、数组索引有针对测试。原旧测试中模拟人工动作改为真实子树语义（完整复制/删除、编辑实际title子元素），未放宽未涉及cell签名断言。
- 四新型固定Chromium原生load/save/normalize/PNG/SVG各两轮：`scripts/probes/drawio-generic-native.mjs`。实际看过四种PNG。架构首次样本37节点/6分组已按PM视觉退回收口成统一宽横带、4–6列标准卡、governance侧栏；最终2058×2227，主交付层5×2，公共系统5×1。分行是首次模板约束，行内用ELK box；不向业务内容添加假边。旧迁移及人工已有XML不受其重排。
- 流程条件标签采用实际文字宽度，且在新模板中为受控edge-label子元素。PM已复看架构/流程当前图，指定视觉问题通过，D07整体未验收。
- 仅新生成route的solver舍入差≤0.5用于确定垂直/水平端点所属轴，再写固定原生端口；保存签名和最终正交/穿框检查保持严格。没有全局坐标容差或人工geometry舍入。
- 新的首次horizontal泳道`orientation.ts`只变换新生成容器/节点，原生load/save/PNG/SVG严格往返已通过：`output/playwright/drawio-horizontal/report.json`，6038×1694。horizontal结构patch尚在闭合，矩阵未提前声明支持。
- 实际原生Ctrl+Alt直选子文本、Delete、Ctrl+D、Ctrl+S：`scripts/probes/drawio-controlled-ui.mjs`，3步骤`delete-item`/`copy-item`/`delete-edge-label`全部通过。确认删除可选item会规范清单与索引；原生复制同主节点item增加条目；删独立边标签只清文字、保留线/正文/badge/两item。操作前真实点击空白清选区，避免误删上一步仍选中的item。原生复制自然偏移可能让副本文字暂重叠，归一化不偷偷重排用户子文本。
- 目标：受控6+旧泳道/编辑32共38/38，新通用5/5，rebind2/2，server tsc通过。上述命令为定向验证，不等同PM最终联合回归。
- 当前未完成：horizontal完整容器增删改排、所有incident边范围、脑图原生分支操作闭环、configure实际字段/显式relayout、泳道迁移剩余边界与最终能力翻转。`configure.ts`是进行中模块，未公开导出，不能作为服务可调用能力。
- B独占并冻结四型`migration/legacy-generic.ts`/测试/探针；A已把通用migration入口按kind接dispatch，仍待最终矩阵/联合核验。无数据库/用户数据写入。
## 2026-10-17 救火冻结：恢复原UI的五型最小引擎链

暂停horizontal/configure/canvas mapping/迁移扩展。既有NativeClient create/save/export签名不变。`profiles.ts`仅开放五型compile/project/patch；configureRendering仍false，迁移仍仅原已验swimlane，orientation仍vertical。不把未完扩展声明为可用。

命令：`node --import tsx scripts/probes/drawio-rescue-native.mjs`。固定项目Chromium、临时独立回环宿主，无数据库或用户preview5189数据写入。沙箱首轮回环ERR_NETWORK_ACCESS_DENIED，同命令获批运行。最终5/5：泳道/流程/架构/脑图/数据流各实际鼠标双击+键盘改文字、native保存、normalize严格投影、公开JSON selection读取businessId、人工Undo/Redo、既有patch实际改文字后公开merge/capture保存、固定renderer原生PNG/SVG与原XML。产物`output/playwright/drawio-rescue/report.json`及每型`*-editor.png`/`.png`/`.svg`/`.drawio`/`.project.json`；已实际查看5型PNG。SVG各约21.9MB（嵌入固定中文字体）。这是实际导出文件，HTTP下载需B/PM真页面单独验收，未冒称网页下载通过。

Host新增固定公开桥：getSelection、mergeXML、undo、redo；保留source/origin/关联/超时/卸载拒绝；URL公开format=0隐藏重复原生右属性栏。真实首次selection遇CtrlAlt反选，改probe先空白清选区；未放宽业务断言。

确定风险：固定31.5.3公开merge不进native Undo历史，undo会越过merge撤销此前人工操作。已向PM/B报告；merge无公开undoable参数，源码DrawioFile.patch的第三参数控制Undo，而embed公开入口未传该参数；未发现公开清栈action。未以文档免责视作已修复。属性提交安全边界待PM裁决，普通原生人工Undo/Redo实际通过。未全局reload、未访问graph内部API。

本批未运行全套/大PBS重复探针、未重启用户preview、未修改生产数据。D07未整体通过。

### 救火最终桥边界（PM批准，已冻结）

保持B调用`mergeXML(xml):Promise<void>`签名，内部不再调用不可Undo的remote merge，而作为**显式内容提交边界**：公开export/xml取得scale/translate，只读当前原生DOM滚动值；公开load新XML携带原scale+模型scroll，清空旧Undo历史。仅用户属性提交调用；普通capture/save/autosave/ack均不load。选区会重置，允许重新选择。固定load不echo message，限定本会话单在途、精确XML相等及既有origin/source校验完成确认。

实际`--commit-boundary`验证：`output/playwright/drawio-rescue-commit/report.json`，400%时before/after scale4、模型视口x313.25/y304、scrollLeft2485/scrollTop2184完全一致；属性后CtrlZ不越界，下一真实鼠标拖动可Undo恢复几何。早期键盘Arrow未移动，未冒称几何通过，最终改为真实body拖动验证。标签变长的boundingBox宽度自然变化，视口按公开scale/translate+DOMscroll计算，未全局放宽geometry签名。

最终UI使用固定官方`ui=min&sidebar=0&format=0`：`output/playwright/drawio-rescue-min/flowchart-initial-ui.png`已实际查看，无第二套标题/文件编辑菜单/固定左形状栏/右属性栏；只剩原生小工具条和底部缩放。真实点击“形状”仍可按需打开FlyMind业务库浮动窗，证据`flowchart-library-ui.png`。同次人工编辑/selection/属性提交/不越界Undo/新拖动Undo/PNG/SVG全部通过，100%视口前后模型x-164/y89、scroll1312/1075一致。未写DOM隐藏。所有自有浏览器/临时HTTP/renderer均finally关闭，无运行probe或后台Runtime。等待PM原UI集中验收，不声明D07整体完成。
