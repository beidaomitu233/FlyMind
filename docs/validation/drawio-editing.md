# D03-A1 原生编辑归一化与结构修改

日期：2026-10-16。状态：待项目经理验收。仅覆盖引擎与操作契约；没有 Host/UI 集成，不代表 D03 全部或 G1 通过。应用、内容标准、adapter 版本不变；没有提交、推送或测试写入用户数据库。

## 接口与文件

入口 `src/drawing/engine/drawio/index.ts`：

```ts
normalizeDrawioEdits(xml: string, base: DrawingProjectV3): Promise<DrawioProjectionResult>
patchDrawio(base: DrawingProjectV3, operations: DiagramOperation[]): Promise<DrawioEngineDocument>
drawioRenderSignature(xml: string): string
```

`projectDrawio` 继续严格投影，不替调用方修复业务绑定。`normalize.ts` 实现原生保存归一化，`patch.ts` 实现局部结构修改，`state.ts` 共享原生容器、锁及身份操作，`template.ts` 提取编译/局部新增共用模板函数，`xml.ts` 提供解析与渲染签名。`engine/preferences.ts` 集中 generic 偏好与 fixed profile 能力校验，compile/project 使用同一规则；project 保留原有偏好校验 public export。

经项目经理窄授权，`core/operations.ts`、`core/layers.ts`、`server/contracts.ts` 统一 update 命令的 null 清除语义，`docs/AI_DRAWING_GUIDE.md` 同步说明。`server/drawing-guide.ts` 读取该文档，无需复制一份规则。完整 content/add 仍不接受 null。仅节点可选业务字段、边 label/kind、group color/kind 可清；node label/kind、edge source/target、container label 不可清。存档省略字段，不写 null。

## 已验证能力

- 显式 fmType/fmKind 新业务节点分配稳定身份；普通无绑定 shape 保持装饰。以 base 原生 cell ID 识别原对象与携带重复 fmId 的副本，为副本分配业务 ID，保留复制内部边的原生端点。
- 保存 A 分配身份、较新的 B 尚未收到元数据确认时，按已确认原生 cell ID 恢复稳定身份，保留 B 的标题、关系、几何与样式。恢复确认元数据后再比锁，覆盖锁定副本确认滞后的测试。
- 跨角色/阶段 reparent 从明确交叉格读取归属，不按像素猜测。两个业务节点间新增原生 edge 形成 flow；连接装饰的普通 edge 保持装饰。正常删除业务节点清关联边；无归属/幸存业务边断开/坏引用拒绝投影，调用方保留错误草稿。
- patch 支持 node/edge 增删改、重连与边 kind，角色/阶段增删改重排，文档标题。使用核心语义校验后局部修改现存 XML，不调用全图编译。无关人工几何、样式、折点和装饰保留；新增/长文案仅在受影响容器安置或扩容。阶段/角色重排同步原生 sibling 顺序，真实 editor 的 tableLayout 保存后几何仍一致。
- note/未知装饰不参与业务步骤占位和阶段撑高；新 note 在独立注释轨堆叠，已有手动 note 几何保留。标题及局部文案可增长，未把扩容宣称为通用碰撞消除。
- AI patch 遵守自身及祖先原生锁，包括仅 description/items/badge 的更新。editor-save 可接受明确移除原生锁后再编辑；仅移出仍锁着的父容器不能绕锁。
- 渲染签名忽略 viewport/grid/page 等 model 属性、XML 属性顺序/格式及几何缺省 0；保留真实几何、样式、折点、装饰与 sibling 顺序，供保存服务判断 no-op。
- 最后阶段删除用例实际 JSON.stringify/parse 后经 operationSchema 执行 phaseId:null，随后删除阶段；保留业务身份、边与角色迁移结果。

## 自测命令与结果

2026-10-16 最终目标回归：

```powershell
node --import tsx --test tests/drawio-engine.test.ts tests/drawio-project.test.ts tests/drawio-editing.test.ts tests/drawing.test.ts tests/runtime.test.ts > output/playwright/drawio-editing/test.log
npx --no-install vue-tsc --noEmit
npx --no-install tsc -p tsconfig.server.json --noEmit
```

67/67 通过，包含原有 26 项 draw.io 引擎/项目测试与 15 项编辑测试；前后端类型检查通过。新增编辑用例覆盖复制、跨列、断开/删除、两轮结构修改、归属、锁、A/B 身份确认时序、无关布局、note、阶段可选与 null 命令/完整内容拒绝边界。全套回归由项目经理独立执行。

## 真实 editor 证据

可复现脚本 `scripts/probes/drawio-engine-editing.mjs`。使用现有 Playwright 与 Chrome；独立随机 loopback 端口，固定本地 draw.io 31.5.3，阻断外网和 service worker；不替换现有服务，不安装依赖。

```powershell
$env:DRAWIO_PROBE_PLAYWRIGHT='C:\Users\12062\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright\index.mjs'
$env:DRAWIO_PROBE_BROWSER='C:\Program Files\Google\Chrome\Application\chrome.exe'
node --import tsx scripts/probes/drawio-engine-editing.mjs
```

最近一次运行：2026-10-16T07:08:38Z，Chrome 155.0.8059.80。源 PBS 23 节点/26 边，实际鼠标从原生业务库拖入节点、Ctrl+D 复制、拖副本跨角色/阶段、原生连接箭头创建边并保存。归一化得到 25 节点/27 边，几何保持；随后两轮 AI 实际增删、跨列、重连、改 kind、重排角色，最终真实 load/save 严格内容一致、规范化几何一致，无关 n15 原生 cell 保留。PNG/SVG 导出成功，已打开最终 PNG 自检。没有外部请求、page error 或请求失败；两次本地 `/drawio/null` 404 记录保留，不影响本轮动作。

证据在 `output/playwright/drawio-editing/`（已忽略）：

- `browser-editing.json`：原生动作、归属、25/27、两轮修改、最终 roundtrip/geometry 断言。
- `editing-ui-insert.drawio`、`editing-ui-copy.drawio`、`editing-ui-reparent.drawio`、`editing-ui-connect.drawio`：真实各步保存。
- `editing-normalized.drawio`、`editing-ai-round1.drawio`、`editing-ai-round2.drawio`、`editing-final-native.drawio`：归一化、两轮修改及最终原生保存。
- `editing-final-editor.png`、`editing-final.png`、`editing-final.svg`：可视与导出证据；`test.log`：最终 67 项结果。

## 限定与未决

当前仅固定 vertical swimlane profile；额外业务 groups、其他四类模板、渲染 op、原生容器复制等未支持操作明确拒绝。普通无绑定 shape 不自动成为业务节点；无明确交叉格归属的新业务节点保留错误草稿。锁对象在同一快照先解锁又删除无法证明解锁过程，须先保存显式解锁。

局部增长和原生 orthogonal 路由不保证全图无交叠。PBS 密集执行阶段仍有少量连线/标签交叠风险；实际手拖节点位置及人工路径会保留，后续 G1 两轮人工/AI 与 D09 质量门槛继续验证。Host 保存队列、并发输入、元数据确认应用、错误草稿恢复属于后续集成范围，本轮接口和单元测试不能代替该验收。
