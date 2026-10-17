# D07-M 四类旧业务图迁移核验

状态：项目经理专项验收通过（2026-10-16）。D07 整体未据此通过。

项目经理独立执行定向测试 **12/12** 和真实原生探针 **8/8**，逐份严格原生签名/内容/绝对节点框及脑图三次曲线核对通过，renderer 已正常关闭。实际查看四型 manual PNG：模块条目/徽标/治理、卡片三种图标/正文和浮动说明可见。证据独立保存在 `output/playwright/project-manager-d07/migration-tests.log`、`migration.log`、`migration/report.json` 及该目录 PNG/SVG/XML。原探针仅增加可选 `FLYMIND_PROBE_OUTPUT` 以隔离验收产物，未改样本或断言。迁移保留旧样本长留白，不将其称为新模板美化成果；下述 blocked 边界保留。

## 接口与范围

独占实现 `src/drawing/engine/migration/legacy-generic.ts`：

- `previewLegacyGeneric(input, {sourceCreatedAt?})`：只读预览，返回既有 `LegacyMigrationPreview`。
- `convertLegacyGeneric(input, {expectedSourceHash, sourceCreatedAt?})`：重新计算并拒绝摘要失配。
- `legacyNativeRoute(path)`：严格读取旧场景的 M/L/H/V 或单段三次 C；不接受未知路径并猜测替代。

源规范摘要、DB 原文字节摘要仍是两种不同的审计依据。该纯模块不连接数据库、不生成当前时间或随机 ID；由 A 在公共 migration 入口分派，B 的存储服务继续执行原 D06 短事务复查。

读取旧 `validateDocument`、`layoutDocument`，每次预览只解释一次旧场景。直接物化绝对框、层归属、原生组合/锁定/绘制顺序、样式和路由；未调用新模板 compile、ELK 或会增高节点的受控字段 writer。架构旧分层侧栏仍保持其实际侧栏框，子模块采用相对坐标保留原绝对位置，不把侧栏扩成新的布局区域。

模块标题、条目、徽标、卡片标题/正文、复合浮动文字分别成为原生可见可编辑文本；字段清单与实际子元素须通过正式投影。卡片图标沿用旧 36×36 SVG 路径与旧 metrics，作为受控正文之外的普通装饰子图元保留，未用隐藏 metadata 冒充可见内容。脑图隐式父子线使用 `decoration/parent-edge/fmChildId`，与 `parentId` 一一校验，不新增 `content.edges`。

## 三次曲线依据

固定供应 `resources/drawio/vendor/js/app.min.js` 的 `mxPolyline.prototype.paintEdgeShape` 读取 `mxConstants.STYLE_BEZIER`（值为 `bezier`），`paintBezierLine` 在四个点时直接执行 `curveTo(P1,P2,P3)`。迁移使用 `noEdgeStyle=1;bezier=1`、固定出入端口和两个显式控制点，未修改供应文件。

真实 probe 在默认四分支脑图和手工覆盖脑图中核对原生 SVG 的 **C 路径全部八个数值**，只扣除原生导出裁切产生的统一平移，误差门槛 0.01。证据在 `report.json` 的 `curveEvidence`，并保留旧 SVG、原生原始 SVG 和保存后的 XML。旧三点共线退化情形的两个重复控制点仍完整保存在 XML；固定原生可能合并重复点绘为等价直线/二次段，不声称其 SVG 字面仍为 C。

## 已执行验证

| 命令 | 实际结果 |
|---|---|
| `node --import tsx --test tests/drawio-generic-migration.test.ts` | 12/12 通过 |
| `npx tsc --noEmit -p tsconfig.server.json` | 通过 |
| `node --check scripts/probes/drawio-generic-migration-native.mjs` | 通过 |
| `node --check scripts/probes/helpers/generic-migration-fixtures.mjs` | 通过 |
| `node --import tsx scripts/probes/drawio-generic-migration-native.mjs` | 最终 8/8 样本通过；固定 Chromium151，renderer 已关闭 |

第一次沙箱启动被本机 loopback 策略拒绝，获准原命令提升后执行。最终真实结果：`output/playwright/drawio-generic-migration/report.json`。本 probe 不启动 Runtime、不打开 SQLite、不写任何用户图形；通过既有公开 Host 协议调用 native save，再正式投影及完整渲染签名核对，并使用真实 renderer 输出 PNG/SVG。它不是新一轮指针编辑或 G1 测试。

八样本覆盖 flowchart/architecture/mindmap/dataflow 各 basic/manual，来源是 `scripts/probes/helpers/generic-migration-fixtures.mjs` 的明确合成 v2 项目；手工覆盖是源输入，不伪称本次鼠标操作产生。包括明确位置/尺寸、端口/折点、标签坐标/颜色/字号、双向箭头/虚线、组合/锁定/顺序、架构治理栏、模块条目/徽标、三种卡片图标与说明正文。单测逐节点核对旧 scene 与 v3 的绝对框，逐边核对全部中间点及原生线型，检查源对象/时间/内容不变、确定性、失效摘要及未知字段阻断。

已实际查看最终 flowchart、architecture（含治理栏与组合）、mindmap（含手工曲线和显式边标签）、dataflow（含三图标和正文）PNG：文本可见，未发现样本字段隐藏或标签挤压。制品旁保存 `*.legacy.svg`、`*.scene.json`、`*.source-v2.json`、`*.project.json`、`*.saved.drawio`、`*.native-raw.svg` 供独立复核。

## 明确边界

- 固定字体替换与原生箭头/阴影的绘制实现不同，不承诺旧浏览器 SVG 逐像素复刻。保留的是业务、绝对框、字号/颜色/形状、路径控制点和可映射覆盖。圆角使用显式绝对半径，避免按节点宽高比例变形。
- 原 flowchart/mindmap/dataflow 没有文档标题；为保存可见文档身份，在旧场景下方追加标题并返回 `DOCUMENT_TITLE_ADDED_OUTSIDE_SCENE`，不移动旧业务对象。
- 旧渲染器把边标签绘在所有业务节点前，原生主边标签随边在节点后。旧 `labelBox` 与业务节点框相交时返回 `LABEL_OCCLUSION_ORDER`，不把可能遮住的标签当作无损 ready。该检查保守按框判断，可能连椭圆外接框角部的轻微相交也阻断；源稿保留，未静默移动标签。
- 旧渲染根本未显示的字段（例如普通 task description、治理模块 badge）返回 `UNRENDERED_SOURCE_FIELD`，不猜新位置或把文字藏入 metadata。
- 跨分层重叠、跨容器组合、成员穿插叠放、旧校验将移除的引用、未知字段/路径和当前 profile 无法表达的默认策略均明确 blocked，且无可提交 project。
- B1/B2 五型配置、SDK 与导入联合闭环仍需 A 的实际能力表/配置入口冻结后验证；此报告不覆盖 canvas-only B3，也不修改旧数据默认行为。
