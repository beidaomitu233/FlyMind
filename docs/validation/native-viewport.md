# 有界双宿主切图封装

`src/drawing/ui/DrawioViewport.vue` 复用 DrawioHost；不改 vendor、引擎或数据。

- props/events、capture/commit/selection/merge/undo/redo/fit/deleteSelectedBranch 均兼容 Host；wrapper 本身不能按 sessionKey 重挂载。
- `prepare({sessionKey,initialXML,title?}):Promise<void>` 创建单一候选；候选独立 Host/controller/source/session，旧Host保留且 inert，候选在底层实际布局绘制（不用 display:none/visibility:hidden 抑制渲染）；两者都被画布加载层覆盖。真实 Host load+双 RAF ready 后 resolve。
- 父层随后把 props.sessionKey 设为候选 key，单一响应式 render 令候选变上层并卸载旧 Host；nextTick 发 ready。不会把旧 controller 跨图复用。
- prepare 超时40秒、原生错误或 discardPrepared 均拒绝待完成 promise、移除候选并保留旧图。更换候选会取消旧 prepare。最多 active+candidate 两个 Host。
- 候选 xml/save 事件不进入原 session，所有事件必须 active key 同时匹配 props key；旧 Host 迟到事件被过滤。初次进入沿用 Host 的工作台背景和失败重试。
- 开发代理不启动 Runtime/浏览器探针；B接线后由PM用既有预览集中验收，最新结果见本文末节。类型检查由B集中运行。

## 历史验收：保留旧画面（随后被用户退回）

原“隐藏英文启动页，等待时显示背景”被用户退回，本实现以保留当前画面直至目标就绪为验收目标。B接入validateLeave/activatePrepared，切图准备前不close旧session、不清sessionKey，创建/导入/重新载入也复用准备过程。仅旧会话关闭清理已令对象closed但IDB写失败时，进入已准备好的目标并提示清理告警，避免返回不可编辑的closed对象；原内容此前已保存或确认草稿备份。

B集中一次`npx vue-tsc -b`通过；PM一次`node node_modules/vite/bin/vite.js build`通过。现有5189同一数据根真实切换架构→脑图→流程→架构：实际捕获准备状态frames=2、原架构标题不变、status=正在切换、原前景frame visibility=visible且aria-hidden=false；完成后frames=1、目标标题及已保存状态正确。流程图切换后真实双击改字，自动保存完成，原生Ctrl+Z恢复，再切图保存正确。没有改引擎、生产数据、应用版本或重启Runtime。

证据：`output/playwright/review-session/retained-report.json`、`retained-sequence-*.png`、`retained-ready.png`。一次暖切换结束过快，等待第二slot的采样未捕获中间态；随后核对目标已正确打开、frames=1，并非产品失败，不以该次采样作中间态证据。候选超时/加载故障回旧流程为源码审查范围，未在用户预览人为制造故障。本批只验切换与受影响编辑，不代表D08/G2全部通过。

## 稳定画布内加载层

2026-10-17 用户进一步要求即时目标tab反馈并允许轻量loading。wrapper新增`loading?:boolean`（默认false），B从点击/网络准备开始置true，至激活目标Host真实ready后置false。常驻DOM覆盖层固定absolute在workarea内，立即不透明浅色背景，140ms后才显示16px spinner和短文字；没有背景淡入淡出、硬性最短等待或布局mount变化。prefers-reduced-motion禁转圈动画，仍显示静态状态。旧/候选controller/source隔离保持。

支持`sessionKey=''`时slots=[]，父层可一直挂载wrapper；无图且非loading时显示默认slot。首次进入/新请求期也通过相同常驻覆盖层遮住工作区，避免旧empty文字/英文启动页闪现。未激活候选始终位于旧Host底层且inert，覆盖层另盖住整个画布；不覆盖产品侧栏/标题。

取消尚未完成prepare会reject并移除候选；对已经resolve但未commit的ready候选，discard同样移除，父层generation必须阻止迟到激活（已resolve Promise不能追溯reject）。本批只改wrapper，B独占即时tab/URL/会话切换。按指令未启动Runtime/探针，实页集中验收由PM执行。

## 项目经理验收：即时反馈与固定加载区域（2026-10-17）

本节替代历史“保持旧标题/选中直到就绪”的交互结论。点击同步更新displayTarget与URL；原SaveSession仍供捕获保存，画布被不透明浅色加载层覆盖。保存与原生初始化前先nextTick+双RAF，确保目标反馈绘制；只有激活目标Host并收到显示ready后解除覆盖。连续点击保留一个最新待打开目标；过期候选清理，最终校验与activate之间无await。工具栏和wrapper常驻，属性栏是否展开由用户控制，切图不自动关闭或改变宽度。

实际验证在已有5189隔离预览完成，没有新建Runtime/数据库：

- 首次进入为固定画布加载层，目标就绪后可见；PBS→脑图点击后立即选中baseline-mindmap、标题同步、status=正在切换且loader opacity=1。
- 脑图→PBS真实捕获16px转圈及短文字，见`instant-loader-sample-2.png`；候选/原图未在目标标题下闪现。短于140ms的加载只出现同色固定背景，不强制延长加载。
- 连续数据流→流程→架构，每次读到最新选中/标题与加载状态；最终baseline-architecture已保存，frames=1，无过时目标重新覆盖。
- 标题栏为(276,0,909.19,70)、工具栏高53、画布y=123高543.66，未展开属性栏时宽909.19；属性栏已展开时宽641.19。分别比较加载前、中、后，尺寸和位置一致。主动开关属性栏导致的宽度变化是用户操作，不计为切图抖动。
- B定向vue-tsc通过；PM两次Vite bundle通过，最终构建包括首帧绘制与纯CSS转圈。无需重启Runtime，刷新预览即采用新bundle。

证据：`output/playwright/review-session/instant-ui-report.json`、`instant-loader-sample-2.png`、`instant-ready.png`。截图/DOM是有限采样，不能证明所有设备零丢帧；候选故障/超时恢复只审查源码，未在当前预览注入故障。没有再次改动业务节点或声称最终全链路集成完成。两位原代理保留待复用，后续路线仍暂停。
