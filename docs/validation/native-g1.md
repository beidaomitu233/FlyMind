# G1 两轮真实 UI / AI 交替验证

状态：项目经理已验收技术贯通指定范围。日期：2026-10-16。历史 PBS 来源业务质量仍待 V06/D09。

## 固定范围

编排入口 `scripts/probes/native-g1.mjs`，同一隔离临时 Runtime、同一默认 SDK STDIO 客户端与实际 NativeStudio；UI 手势复用 A 的 `helpers/native-editor.mjs`、`helpers/g1-ui-scenario.mjs`。仅使用固定 Chromium 151，业务写入均走正式 API/工具，UI 不调用内部 graph/model。

先以真实 MCP 从纯 content 创建质量合格的工业工单泳道并验证五制品。PBS 则由现有脱敏夹具经人工结构入口载入：23 节点、26 边、38 分及所有原始 issues 原样记录；不宣称通过 AI 新建门槛，不猜补来源关系。

计划链路：

1. UI 轮 1 改 n02 短文案并移动/缩放，另移动 n06 为无关人工几何锚。
2. MCP 读取最新 revision，在 e02(n02→n03) 中插入明确“测试演练”步骤 g1-test-step，真实新增/重连；验证 n02/n06 人工几何/样式保留。
3. 真复开后 UI 轮 2 复制该测试步骤至 r02/p02，真实连接 n02→副本→n03，另复制临时节点后 Delete。
4. MCP 最新读取后删除真实副本/测试步骤及关联边，恢复 e02；回到原 23/26，保留全部原质量问题与无关布局。
5. 真实 UI 保存冲突保留 IDB 草稿/可下载而不覆盖远端。关闭全部用户页后后台真实导出并复开核对。
6. 受控原生 XML 为 n02 添加未供应字体（明确不是 UI 手势）触发真实 worker 失败；不得返回旧 PNG/重建图。以明确最新 revision 恢复字体，导出新修订新任务，原任务继续 failed。

## 首次执行记录

`node --import tsx scripts/probes/native-g1.mjs` 首轮已通过工业纯内容创建与 PBS 原样载入。UI 文字修改保存到 r2，随后 moveResize 等待保存超时；截图显示 Fit 25% 后选择了表格/交叉格容器，未见业务节点移动成功。证据保留于 `output/playwright/native-g1/{result.json,failure.png,failure-record.json}`，临时根见 result。Runtime 已 graceful-exited。

已反馈 A 窄修原生选择/拖动/缩放命中，不扩大 timeout，不据此修改产品。增加 `--round1-only` 模式，独立输出 `output/playwright/native-g1-round1`，先验证该手势再继续全链路。

尚未通过的步骤不计为 G1 证据；本报告后续追加最终实际结果。

## UI 窄定位结果（不替代完整 G1）

固定原生 DOM 显示缩放为 `input.geZoomInput`，不是文本菜单；50% 时小节点隐藏四角 resize 控点，仅显示带 cursor 的 E/S 等侧控点。已按真实 DOM 用原生输入控件缩放、业务选区矩形确认选择、实际 body 拖动与 E/S 两轴控点缩放；每次公开 Ctrl+S XML 与 API 几何均有真实变化，保存确认前后视口/选区不变。未修改 vendor 或产品模板。

- `node --import tsx scripts/probes/native-g1.mjs --round1-only --interactive-ui`：同页热载复测通过。第一次只完成文案的 r2，在重试前真实恢复原文案，再执行文案、移动、两轴缩放、n06 锚点移动，最终 r8。独立输出 `output/playwright/native-g1-round1`；graceful-exited、tempCleaned=true。该累计诊断修订不冒称 fresh 完整轮次。
- 首次 fresh 完整链已完成工业 MCP 创建、原 PBS 载入、UI1 r6、MCP 结构1 r7；全既有 cell 只读检查确认除 e02 外 88 个 cell 保留，包括 25 条既有边与 24 个 decoration。首次失败已归档 `output/playwright/native-g1/attempt-01`，本次中途证据归档 `attempt-02`。
- R2 原先在小比例中心点连接时生成 dangling target，服务拒绝并保存草稿符合约束；真实失败 public save XML/IDB 证明新 edge 的 source 正确而 target 为空，未伪造连通。后来接管 connect 定位的冻结版本使用真实 50% 缩放、精确原生 plusTooltip 源箭头、目标内部 body，并在等待 API 前硬校验公开 XML 的真实 source/target cell ID。
- `node --import tsx scripts/probes/native-g1.mjs --round2-only --interactive-ui` 最终通过，`output/playwright/native-g1-round2/{result.json,ui-round2.json,g1-round2-human.png}`。固定读取忽略输出的 ai-round1 检查点，正式 validate v3 后在新临时库经 manual + editor-save 受控恢复，再真实执行复制、跨 r02/p02、n02→副本→n03 两条连接、临时副本 Delete，r2→r7；graceful-exited、tempCleaned=true。检查点恢复明确是受控准备，不称人工交互。

诊断模式仅 round1/round2-only 可选 interactive-ui，固定忽略输出 signal 只收 retry/stop、总寿命 10 分钟、finally 正常关闭自有 Runtime。重试重新读取当前服务数据；显式“重新读取远端”保留本机草稿后才重挂 Host，删除先前测试副本也走真实 UI。默认完整模式不开放此循环或任何 HTTP 调试口。

## 视觉退回与修复范围

PM 视觉审查退回 e02 端点更新后沿旧 ports/offset 穿节点叠字，以及旧首次模板 e12/e17 标签/竖轨冲突。A 独占引擎 routing/首次 compile 标签策略，B 不修改引擎；A 另将 R1 明确位移 dy40 改 dy20，避免人为压 e03。最终完整链使用 A 冻结后的实现。

正式完整脚本已扩充泛化签名：AI1 只排 e02，AI2 只排 e02 及明确删除的测试对象；所有其余既有 edge 的 parent/geometry/style、装饰与容器均断言保留，不以两个节点取代折点/样式/装饰证据。

## 最终实测

实际命令：`node --import tsx scripts/probes/native-g1.mjs`（获准沙箱外执行临时 Runtime/浏览器）。2026-10-16 10:37:45Z 启动，固定 Chromium 151.0.7922.34，默认 SDK STDIO。同一自有临时工作区完成以下 11 组检查，`output/playwright/native-g1/result.json` 为最终结果：`ok=true`、`errors=[]`、`externalRequests=[]`、空 MCP stderr、`shutdown=graceful-exited`、`tempCleaned=true`。

| 证据 | 实际结果 |
| --- | --- |
| `industrial-created-export.json` / `.png` | 纯 content MCP 新建合格工业泳道；真实 PNG 签名/尺寸及同快照五制品摘要核对 |
| `pbs-original.project.json` | 人工结构入口载入来源夹具，r1、23 节点/26 边、38 分，原四项 issues 保留 |
| `ui-round1.json` / `.png` / `.project.json` | 真实文字、body 拖动、E/S 控点缩放及无关 n06 移动，r6；保存 ack 前后视口/选区一致 |
| `ai-round1-export.json` / `.project.json` | 最新 MCP get 后真实插入测试节点、重连 e02、新增返回边，r7 |
| `ui-round2.json` / `.png` / `.project.json` | 真实 CtrlD、副本跨 r02/p02、两条真实端点连接、临时副本 Delete，r12；UUID 从实际 normalize 结果读取 |
| `ai-round2-export.json` / `.project.json` | 最新读取后删除实际测试节点/副本及关联边、恢复 e02，r13，回到 23/26 |
| `conflict-summary.json` / `conflict-recovery.json` / `conflict-idb.png` | 真实并发远端更新后 UI 保存 409，本机 IDB 草稿仍在且可实际下载，远端未被覆盖 |
| `background-no-user-page-export.json` / `.png` | 全部用户页已关闭（pages=0）后由同一后台 Runtime 导出五制品 |
| `reopened-after-background.project.json` / `reopened-final.png` | 重新打开 r13，content/XML/render signature 一致；`execution-density.png/json` 留存实际 100% 密集区域视图 |
| `real-render-failure.json` / `font-fault-saved.project.json` | 受控原生 XML 添加未供应字体，真实 worker 报 UNSUPPORTED_FONT；保存身份 r15 返回，未附旧 PNG/files、失败 PNG 读取 409、同键重放不重复建图 |
| `recovered-new-revision-export.json` / `recovered-final.project.json` | 明确最新修订恢复字体并恢复标题，r17 新 job 成功，原 job 仍 failed、图形数量不变，最终 content 等于 AI2 |

`result.json` 的 `round1AllCells` 与 `round2AllCells` 各核对 86 个未受内容操作影响的原有 cell：25 条边、24 个 decoration、3 个 annotation、20 个业务节点、10 个 phase cell、4 个 lane cell；每个 parent/geometry（含折点）/style 摘要逐一相等。排除项在结果中显式列出：AI1 仅 e02；AI2 为 e02 与明确删除的测试对象。n02/n06 人工几何另有逐字段对照。所有阶段质量保持 38 分及原四项 issues，不把测试步骤视为来源业务修复。

## 手势窄修与保留失败证据

最终 R2 定位失败证据保存在 `output/playwright/native-g1-round2/interactive-{1,2,3}*`：源节点屏外时，先清选区、真实 wheel 令两端 body 同时可见，重取 DOM bbox 后才拖真实连接箭头；公开 save XML 必须具有真实 source/target cell ID。固定 20,20 的所谓空白在滚动后会点中文档标题，已按 PM 批准改为公开 Ctrl+Shift+A（固定 vendor 的 selectNone），DOM 确认 resize 选区清空，再 CtrlAlt 直选；唯一蓝业务选框与灰父格提示框分开识别，未改 R1 move/resize 逻辑。

同页诊断曾在删除带连接的旧副本后留下本地 dangling edge；服务拒绝后草稿保留，下一轮明确“重新读取远端”再验证。没有改变 normalizer 的断边约束，也未把这次诊断清理当正式业务编辑成功。最终 R2 窄验 r2→r11，graceful-exited/tempCleaned=true；最终 fresh 链从全新临时库完整执行，未复用诊断数据。此前完整失败证据另归档 `native-g1/attempt-03-before-selection-fix`，不与最终 result 混淆。

## 额外测试窄修与边界

依 PM 授权，`tests/drawio-native-storage.test.ts` 的已关闭临时 SQLite workspace 替换改为先原子 rename 至同一临时根 retired 目录，再在原路径初始化真正新 workspace；仍断言 dataRootId 改变。仅该测试 cleanup 对 Windows 已关闭 SQLite 的瞬态 ENOTEMPTY 有限重试，持久错误仍失败。命令 `node --import tsx --test --test-name-pattern="pilot defaults off" tests/drawio-native-storage.test.ts`：沙箱 rename EPERM 后原命令获准重跑，1 通过、10 名称不匹配跳过；未修改产品 store。

本轮不重跑已通过的 D05 或宽泛 renderer/单测；完整联合回归与最终视觉验收由 PM 执行。用户生产库未触及；PBS 原始业务缺口仍未解决。G1 待 PM 验收，未开始 D06。
