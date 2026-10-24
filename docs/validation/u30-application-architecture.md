# U30 应用架构默认渲染修订（待PM验收）

日期：2026-10-24。本批无提交/推送/发布/版本变更；未访问用户Runtime或用户库。技术图独立布局由application代理负责，本报告主体为应用架构完整样本。

## 差异与渲染方案

之前native把所有module放成同款300px卡片、items单列，标题横条占48px，统一列数，治理只按内容自然高度；默认theme未显式给出时落indigo，丢失了原应用图的蓝/绿层次。不能以3节点技术样本证明完整应用架构视觉。

基线为 `core/layout.ts` architecture分支及 `core/render.ts` 模块渲染；旧原用户附件已删除。本次只以**当前**sampleFor('architecture')的37节点、6组、2边完整业务数据做对照，不声称像素级还原率。

- 新 `drawio/architecture-layout.ts` 是首次/明确relayout的渲染策略，未给content塞位置/列数/颜色。默认主带1900宽；6应用端一排、业务5×2、系统一排、AI3×3、数据源三分区；按层规模和实际items密度推断。显式现有groupColumns hints优先。
- 实际人工hints尺寸参与带宽计算（至少容纳每列最大实际宽度），不再把420px人工模块硬塞283px槽。旧顶header转为只读top inset hints，保留旧style不改成新左标题。
- 原生可移动/缩放swimlane容器，100px左窄色带，正向独立layer title文字（relative y=.5）可编辑并严格投影；治理为淡slate/lavender全高栏、深灰标题。蓝/绿常规层，3期保留橙边/橙badge及浅暖底。
- 每个title/item/badge仍独立受控mxCell文字：短items两列，长item独占整行，原业务fmItemIndex不变，字号12px不随内容缩小；标题15px（治理14），无裁切/省略。系统模块正文两排小格，约94px高。无新sections语义。
- 默认architecture为blue；显式preferences.theme、nodeDefaults fill/font等仍优先。新元素collapsible=0去掉原生[-]，不全局覆盖旧文档人工显式样式。
- 普通AI改字不调用布局器、不补回人工删除图标、不重置同节点足够容纳短文字的人工几何；新增节点继承新grid字段且避左色带。真正变长/新增需局部扩容仍检查安全位，可能明确拒绝而不偷偷移动其他层。

## 可审图片/源文件

`scripts/probes/drawio-architecture-appearance.mjs`：完整当前sample→旧renderScene仅生成视觉参考，再以固定31.5.3 NativeDrawioRenderer真实load/save/export生成新PNG/SVG/XML。旧引擎仅作参考，不进入生产主链。

`output/playwright/drawio-architecture-appearance/`：

- `reference.png/reference.svg`：当前sample经接入前布局/渲染代码生成的参考，**不是已删除原附件**。
- `before-native.png`：旧native默认样式示例，来自此前脱敏fixture，业务字面不完全相同，**不可当同输入严格像素对照**。
- `architecture.png`：最终2172×1239，37节点/6组/2边；已实际查看。`architecture.svg/.drawio/.project.json`为同原生快照可编辑产物。
- `report.json`：内容逐字段相同、contentHash严格相同、整个drawioRenderSignature相同；普通改doctor文案后b3全cell签名不变。最终原生渲染约6秒，仅单次观测，不是性能分位数。

本地命令：`C:/nvm4w/nodejs/node.exe --import tsx scripts/probes/drawio-architecture-appearance.mjs`。固定hidden-browser，无可见终端浏览器、CDN或用户服务。

## 原生编辑保持（本次新profile）

复用 `scripts/probes/drawio-technical-ui.mjs architecture`，通过环境 `FLYMIND_PROBE_OUTPUT` 隔离记录：

- `.../node-resize/`：真实E/S拖柄283.67×122→367.2×168；原生保存→AI短文案→新iframe重开尺寸保持。
- `.../container-resize/`：真实E/S容器1900×150→2026×212，鼠标移动(24,128)→(80,180)；保存/重开/AI改字后容器和全部节点相对几何逐个不变。测试允许人工移到别的区域，证明自由编辑，不将手势结果宣称自动避碰排版。
- 公开原生selection导出确认目标子树；必要Alt+Shift+P选父框；根据真实DOM灰色虚线选框拖动色带空白区，不使用graph内部API或XML注入冒充手势。

## 源码与定向验证

主要路径：`engine/drawio/{architecture-layout,generic,controlled,index,generic-patch,layout-hints,relayout,routing}.ts`。独立回归 `tests/drawio-architecture-appearance.test.ts` 5项覆盖完整布局/可编辑条目、左标题投影、人工几何配色、放大后relayout不叠、旧顶header/style保护和新节点避标题区；controlled/generic原回归仍保留。

技术图仅共享必要接线：generic消费B的technical-layout与端口/样式API；routing将类别端口传真实solver，不吞对角/碰撞；startSize=0不造假内部header，外置caption按真实文字宽/字号tight占位。native-canvas仅允许旧品牌SVG和本次固定静态TECHNOLOGY_ICONS的精确data URI，任意SVG仍拒绝。技术图完整PNG由B单独验证，本报告不代替其验收。

## 边界

不重排用户现有图、不覆盖旧style；本次新外观仅新建与新样本生效。旧图显式relayout保留原style，新增top header hints防穿标题；套用新视觉风格不在本批自动发生。未扩展迁移、映射、导入、评测或UI。效果交PM及用户审阅，不自评还原分数。

## 最终兼容收口（2026-10-24）

执行 `C:/nvm4w/nodejs/node.exe --import tsx --test tests/drawio-technical.test.ts tests/technical-layout.test.ts tests/drawio-architecture-appearance.test.ts`，15/15通过（旧3节点technical契约6项、technical布局4项、完整architecture5项）。纵向root标题留白统一由technical-layout负责，generic删除重复实现以消除parent推导类型错误；横向完整样本不受影响。图标资源仅精确允许固定旧brand及本批固定cyan/通用TECHNOLOGY_ICONS的编码URI，任意SVG拒绝回归仍通过。

本批代码冻结；未重跑完整PNG/resize或启动用户Runtime，最终集成构建和页面验收由PM执行。
