# D02-B v3 项目模型与内容摘要

日期：2026-10-16。状态：**待项目经理验收**。范围为独立项目模型，不改变现有 v1/v2 读写，不自动迁移或创建用户记录。

## 接口与模型

- `src/drawing/engine/content-hash.ts`：`canonicalContentJson(content)` 与异步 `contentHash(content)`。SHA-256 使用 Web Crypto，生产模块不导入 `node:crypto`。对象键按词典序规范化，数组次序保留；可选 object 字段的 `undefined` 按 JSON 省略，非法数值、非 JSON 对象、循环或稀疏数组拒绝。
- `src/drawing/engine/project.ts`：`createDrawingProject(content, engine, options?)`、异步 `validateDrawingProject(input)`、`validateRenderingPreferences(input)`。
- v3 的层次为 `schemaVersion/content/rendering/createdAt/updatedAt`；content 保持 schemaVersion 1。修订、分组和同步状态不放进项目正文。
- 使用项目经理提供的 `engine/types.ts` 和 `engine/constants.ts`；D02 固定 draw.io 31.5.3、adapter 1、`swimlane-standard` profile 1。未知引擎、适配器、profile 或版本拒绝。未来 D07 显式扩展，不静默回退。

`createDrawingProject` 接收引擎编译结果，仍调用完整正式校验，不能用创建入口绕过 XML 与内容一致性。它返回脱离输入对象的副本。options 只接受 profile、preferences 和两种时间；不写 store、不触发 init、迁移或文件持久化。

## 校验边界

正式校验先检查精确层次、必填字段、现有内容引用和合法字段，再计算内容摘要，最后通过 `projectDrawio(xml, content)` 重新投影原生 XML，并核对重新得到的内容及投影摘要。即使调用者更新自报 hash，混合旧 XML 与新业务内容仍须拒绝。引擎结构错误直接失败；纯装饰或布局提示 diagnostics 不等于内容错误，不因此拒绝结构合法人工草稿。

preferences 仅接受 theme、orientation、nodeDefaults、edgeDefaults。节点标准允许通用宽高/字号/形状/颜色；这些是类型默认标准。`positions/ranks/phases/texts/styles/cards/edges/objects`、每个对象的坐标/折点、内容节点及其他未知字段均不接受。标准的嵌套字段、枚举、数字范围和颜色格式独立严格检查。人工位置、路径、组合与装饰以 XML 为唯一事实；校验成功原样保留输入 XML，不用重投影产物覆盖几何。

通用 preferences 枚举保留 horizontal；组合到本轮固定的 `swimlane-standard` v1 项目时显式拒绝，因为当前编译器只实现 vertical。未指定方向视为该 profile 的默认竖向，不能保存当前模板无法生成的方向标准。

同理，通用 `edgeDefaults.route` 保留 orthogonal/straight/curved 枚举，但当前固定 profile 的项目组合校验只接受 orthogonal 或未指定；straight/curved 在创建和正式校验入口均拒绝，避免存入当前编译器不能生成的线路标准。

当前固定 profile 的 `nodeDefaults.width` 最小为 64；通用偏好校验仍为 32–2000。高度标准仍可为 32，编译器按实际文案扩高。与引擎代理核对后，浮动 note 标准支持 width/height/fontSize/fill/stroke/textColor；正式项目仅拒绝 `nodeDefaults.note.shape`，因为 note 仍是独立浮动文本。通用偏好保留 shape 枚举。

时间必须为正的安全整数且处于 JavaScript Date 可表示范围，updatedAt 不早于 createdAt。两者均不传时使用同一当前时间；只传一种时间时另一种采用同一值，避免导入旧时间时悄悄改为当前时间。校验不更新业务时间。

本阶段只验证结构合法性，不调用质量准入写操作。PBS 既有缺条件、孤立节点等问题保留；结构合法的人工草稿仍可创建独立 v3 对象，不等于该图通过质量门槛。

## 测试及证据

测试文件：`tests/drawio-project.test.ts`。实际执行：

```powershell
node --import tsx --test tests/drawio-project.test.ts
node node_modules/typescript/bin/tsc --noEmit --target ES2022 --module ESNext --moduleResolution bundler --strict --skipLibCheck src/drawing/engine/content-hash.ts src/drawing/engine/project.ts tests/drawio-project.test.ts
```

覆盖内容：摘要与标准 SHA-256 一致、对象键重排稳定/数组重排敏感、非法 JSON 拒绝、泳道及 PBS 基准往返、时间保留、输入不被修改/返回副本隔离、旧摘要拒绝、业务内容或原生标签篡改拒绝、XML 单独几何变化保留、未知层次/版本拒绝、内容和偏好不能串层、偏好嵌套类型/范围拒绝。

测试 **10/10 通过**，无跳过；目标 TypeScript 检查退出码 0。证据：`output/playwright/drawio-project/test.log`、`typecheck.log`。其中 PBS 内容维持 23 节点/26 边及质量分 38，不补造关系；原生标签篡改、内容与 XML 失配、固定 profile 的水平标准都被实际拒绝，修改 XML 几何后业务内容和原始时间保持不变。输入对象在异步校验期间被调用者修改时，返回的仍是首次 await 前捕获并通过校验的快照。

另已实际执行 Node 20.19.6 的 Web Crypto 摘要计算，并使用测试端 `node:crypto` 对最小内容和 PBS 内容进行独立摘要对照，结果一致；该 Node 模块仅用于测试，不进入浏览器实现。没有在此任务运行真实浏览器中的 v3 模型；浏览器兼容由标准 Web Crypto/TextEncoder 与不含 Node 内置模块的实现支持，完整浏览器链路仍待后续验证。

尚未集成 package test，由项目经理统一处理测试入口。本任务不修改 package、共享类型或台账。

### 固定线路能力补查

按项目经理能力结论补充 profile/线路组合约束后，仅重跑 B 项目模型测试：`node --import tsx --test tests/drawio-project.test.ts`，结果 **11/11 通过**、无跳过。新测试确认通用偏好仍接受 straight/curved，但 `createDrawingProject` 和 `validateDrawingProject` 均拒绝；orthogonal 项目正常接受。证据：`output/playwright/drawio-project/route-guard-test.log`。本次没有重跑整套测试或构建，先前 TypeScript 和项目经理联合测试结果保持其原有执行时点，不作为本次新增运行记录。

### 固定宽度与 note 标准补查

补充最小宽度及 note 标准接入限制后，仅执行上述 B 测试入口，最终结果 **12/12 通过**、无跳过，证据：`output/playwright/drawio-project/profile-capability-test.log`。新增用例实际验证通用偏好接受宽度 32/63，而项目创建与校验拒绝；宽度 64、高度 32 项目可接受；note 的空对象、宽度或形状配置均被项目组合拒绝。未修改引擎代理文件，也未重跑完整应用测试/构建。

后续引擎能力确认后，项目经理要求将 note 限制收窄为仅拒绝 shape；前一记录中的“整个 note 标准拒绝”已被替代。最终用例加入带真实浮动 note 的 compile→create→validate 往返，同时提供 width/height/fontSize/fill/stroke/textColor，验证配置及内容保持一致，并接受 note 空对象；shape 仍在创建及正式校验入口拒绝。仅重跑 B 测试，结果 **12/12 通过**、无跳过，证据：`output/playwright/drawio-project/note-capability-test.log`。引擎代理直接确认 note 与通用标准的上限和字号/颜色格式一致，宽度仍须 ≥64；没有修改 A 文件或扩大其他能力范围。

## 不包含的行为

没有读取或写入生产数据库；没有迁移、修改旧 store/model/layers/UI/Runtime/MCP；没有运行编辑器、导出图片或保存用户记录。v3 仅为后续存储和编辑集成准备，不能宣称 D03/G1 已实现。
