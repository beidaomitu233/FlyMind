# FlyMind 开发验收台账

## 2026-10-20 v1.1版本合并规划：方案已形成，实施未验收

用户确定将线上协同一期、MCP持久更新、功能导入优化与GitHub部署合并为目标1.1.0，并明确本期包含**同图多人实时编辑**。范围与实施入口为[版本计划](releases/V1_1_PLAN.md)。原 `/root/dev_application` 与 `/root/dev_engine` 持续复用，未新建/删除代理。

- 原应用代理：只读核查现有单图导入/侧栏/云端权限，交[导入与操作记录契约](releases/V1_1_IMPORT_AND_ACTIVITY.md)。PM退回全批原子/默认180天清理/额外历史恢复前置，已改为每图原子与分项重试、默认不自动清理、仅记录既有或另获授权功能；补齐协同增量actor归因。
- 原引擎代理：只读核查现有CI、冻结云端与固定供应，交[GitHub部署设计](deployment/GITHUB_DEPLOYMENT.md)及docs下不可启用示例。涵盖完整C03、单活写入、协同未ACK状态、真实目标OS出图、健康与回滚；没有创建活跃workflow、部署脚本或容器镜像。
- PM定点复核后：导入改动与主计划一致；部署样例手动入口只做生产晋级，修掉原“选择staging后无可运行job”的路径，并更新完整C03范围引用。V11-00方案已冻结，不代表V11-01–07功能或发布已通过。
- PM：统一v1.1 PRD/技术/实施/AGENTS入口，纠正旧独立MCP方案中“不将实时协同作为整版前置”的过时边界；保留当前未提交质量改动和冻结协作快照。不切换本机工作区、上传原图、提交/推送/打标签或提前改称已发布1.1。
- 本轮检查仅为文档事实/交叉链接/差异检查，不重复此前运行时测试；v1.1功能、真实双端协同、真实Java/MySQL/Redis、升级及公网部署均未因文档完成而验收。

下一步：按V11-01–07实施并逐批交验；服务器信息到位后先只读核对现有OS/CPU/服务/端口/数据卷，再固化GitHub环境、固定制品和受限SSH部署。尚未提供SSH不是源码开发停止的理由；真实公网发布须有实际环境和通过证据。

## 2026-10-18 MCP 公开安装包：进行中

02:47起用户授权按照 npm + MCP Registry 流程执行并提供推广用安装使用文档。固定复用原 dev_engine（P01 CLI/预编译/持久目录/固定资源）与 dev_application（P02 元数据/许可证/文档），PM负责P03独立安装与最终集成、发布核验；本批不开发新白板能力或迁移真实数据库。用户已明确选择MIT。npm包名联网核对返回404（flymind-drawing-studio当时未发布），本机npm未登录；已询问用户发布账号。无凭据写仓库。

验收目标：从tarball生产依赖安装、首次初始化与诊断、真实STDIO五类生成/修改/返回图片和编辑链接、工作台保存/导出、同库复连保留数据、安装目录外的数据和资源、包内容与第三方许可检查。尚无证据的项不标完成。最终推广文档计划为docs/INSTALL_AND_USE.md，维护者发布步骤另列。

约03:09本地P01/P02通过：独立Temp安装168包/48秒，真实网络下载固定资源及doctor；五类SDK均真实PNG与五制品，分组互斥/同库复连通过；实页改字r3与PNG下载39016B，通过复装包后MCP读r3再改r4/39721B PNG，正常停止自有QA。npm test309+CLI4全部通过、build通过，详见[分发验收](validation/npm-distribution.md)。首轮沙箱rename EPERM和初次探针未计入5个只读示例的失败均留存，没有改业务/放宽校验。用户明确npm账号稍后再办，改GitHub优先；不再继续npm登录。新下载标签mcp-v1.0.0，原v1.0.0不移动，应用版本不改。当前准备推送源码和4个Release制品，最终远端结果待回读。

约03:12 GitHub发布核验通过：main主体062ee36、新标签mcp-v1.0.0、Release已公开，ZIP/tgz/安装文档/校验文件4个assets的size/digest与本地一致。P03指定范围通过，npm/Registry按用户决定延期。发布后CI发现Windows源码检出将固定许可证转CRLF导致setup hash拒绝；退回原A补.gitattributes，不放宽校验、不改已发布安装包。PM同时补交首次暂存遗漏的server.json（该文件已包含于并验过安装包），保留已发布标签不动。远端CI复核随后记录。

03:20源码CI收尾：8553877资源准备/构建已通过，但托管runner的RUNNER~1临时路径别名触发既有路径边界，另有测试.ps1持锁helper未就绪。PM仅改CI临时目录为runner.temp，原B仅把该helper改为固定内联-Command并增加stderr诊断，全部安全断言不变，正常权限13/13通过；PM复审通过后推送新CI。发布包及两个已发布标签不改；匿名下载ZIP的SHA也已通过。属于源码CI可复现性收尾，不扩展应用或重新绘制测试图。

03:24 最终CI已通过：872b57e代码在GitHub Windows / Node22.23.3完成npm ci、固定资源setup、build、309+4 tests，总2m39s，run39062115483 success。一次runner上下文放job env的YAML校验失误已移至test step env修正；无应用逻辑/校验/失败用例弱化。P01/P02/P03本批均已验收，公开Release和4制品已核对，npm/Registry按用户决定延期。剩余宽路线仍按原状态，原两代理继续保留。本次后续提交只记录这些验收事实。

更新日期：2026-10-16。主代理负责项目管理和验收，固定复用两个 `gpt-6.1-sol`、`medium` 开发代理。开发自测通过不等于任务验收通过；未授权提交、推送或版本更新。

## 固定分工

| 开发代理 | 职责 | 当前任务 |
|---|---|---|
| /root/dev_engine | draw.io 资源、模板、内容/原生文档映射与引擎适配 | D07-A 五类模板/投影/配置/分型迁移 |
| /root/dev_application | 存储、Runtime/MCP、工作台集成与回归设施 | D07-B 业务能力接线及分批导入 |

两个固定代理已创建，名称即当前会话的继续派单标识。后续用 followup_task 向原代理继续派单，send_message 协调进行中的任务；无需销毁重建。共享文件及接口先协调再修改。

## 当前任务

| 派单 | 状态 | 可修改范围 | 验收要求 |
|---|---|---|---|
| D01-A | 已验收 | 独立供应检查脚本、供应证据文档；引擎实现暂不变更 | 本地 draw.io 来源、版本、资源哈希、许可范围、字体/浏览器供应及协议检查结果可复现 |
| D01-B | 已验收 | 独立数据检查脚本、脱敏夹具、数据核验文档；生产数据禁止写入 | 在线一致备份与副本校验，实际 PBS 和五类样本基准，不虚构数据 |
| D02-A | 已验收 | engine/drawio、新引擎测试与独立探针、实现证据 | 真实泳道原生可编辑、内容往返、长标题、正交连线及安全拒绝 |
| D02-B | 已验收 | engine/content-hash、engine/project、新项目测试与证据 | v3 两层严格校验、稳定哈希、重投影一致、时间保留、错误拒绝 |
| D03-A1 | 已验收 | engine/drawio、独立偏好能力校验、新引擎测试与探针 | 新增/复制/删除/归属归一化，严格内容结构 patch，保留无关人工几何 |
| D03-A2 | 已验收 | DrawioHost、独立消息控制器/内联业务库、对应测试/探针 | 同源安全握手、单次加载、原生编辑与 XML 捕获、迟到消息隔离 |
| D03-B1 | 已验收 | store、document-record、application/native-diagrams、隔离路由与测试 | 同库同 ID 保存 v3，混合记录、CAS/历史/删除/恢复、重试幂等与旧写拒绝 |
| D03-B2a | 已验收 | 独立 native client/session/drafts 及其测试 | 单请求队列、迟到响应隔离、精确重试、工作区身份绑定草稿；先不改 Vue |
| D03-B2b | 已验收 | NativeStudio、独立样式/路由、native client/session/drafts、隔离 API 身份校验、对应测试 | 真实 IDB 保存/恢复、切图与下载；后台换库拒绝旧客户端写入；默认入口不切换 |
| D04-A | 已验收 | 固定资源/字体模块与安装脚本、独立原生renderer、Host公开导出扩展及测试 | 固定Chromium/字体、无页面PNG/SVG、尺寸预算/失败/关闭与实际原生比较 |
| D04-B | 已验收 | 导出任务store/service/router、发布与读取、NativeStudio导出接入及测试 | 不可变修订、租约/幂等/失败恢复、五种制品与导出时间、不更新文档 |
| D05-A | 已验收 | 独立 Runtime 启动/握手模块、runtime/start 装配、会话接入及对应测试 | 单实例、数据根/能力/版本准确、隐藏按需启动、退出不误杀共享后台 |
| D05-B | 已验收 | native 应用服务/路由、MCP 原生 facade 与契约、质量准入及对应测试 | 同一 MCP 会话中后台重启恢复、固定工作区身份、未自动重放 |
| G1-A | 已验收 | 原生画布真实操作 helper、复杂 PBS 视觉与两轮人工动作 | 与 B 同 Runtime 编排；不以 XML 注入冒充手势 |
| G1-B | 已验收 | 真实 STDIO/Runtime 两轮交替编排、冲突/失败/离线导出 | 最新 revision、人工布局保留、关闭 Web 导出及复开一致 |
| G1-V | 已验收 | 固定官方libavoid、局部edge路由、首次模板标签及回归 | 指定三真实样本已独立通过；不等于整个G1通过 |
| D06-A | 已验收 | engine/migration、专用测试/探针/报告 | 两真实样本独立通过、最终245/245 |
| D06-B | 已验收 | migrations/backups、新应用服务、store窄事务与专用测试/探针 | 独立真实恢复10项通过、最终245/245 |
| D07-A | 进行中 | engine profiles/templates/controlled mapping/patch/configure/migration与专用验证 | 五类实际可编辑/投影/导出、配置实际生效、旧图不丢字段 |
| D07-B | 进行中 | 共享服务/能力/MCP、分批导入及原生UI接线 | 只公开真实能力、导入新身份/来源/幂等、canvas-only不伪造内容 |
| D07-M | 已验收 | 原B独占migration/legacy-generic.ts与专用验证；A保留dispatch/共享契约 | PM独立12/12、真实8样本保存/导出；明确blocked来源边界 |
| D08-P1 | 已验收 | 原B独立metadata视图模型和测试，未接UI | PM独立7/7；D08整体待D07后接线 |
| D07-M2 | 进行中 | 原B独占legacy-swimlane.ts与专用新增测试/probe；A保留dispatch/共享契约 | 关闭旧水平/复合批注/曲线等待适配项，不改旧scene几何/业务，真边界明确blocked |

## 回报与验收

以下按阶段保留退回、修复与验收过程；当前进度以顶部任务表及末尾最新派单为准，继续通过 followup_task 复用原两个代理，未新建替代代理。

### D02 首轮独立审查

项目经理实际运行两组新测试：20/20 通过；`npm.cmd run build` 通过。新增测试已纳入 `npm test`，应用版本仍为 0.6.0。这些结果不能替代原生图片的视觉验收。

查看 `output/playwright/drawio-engine/pbs-main-editor.png` 和 `pbs-main.png` 后退回 D02-A：角色表头白底白字不可读；多个边标签被压成逐字竖排并遮挡节点。另要求修正已接受但未生效的箭头配置、无 base 回读的数组次序，以及长标题/浮动文字尺寸。开发代理在原会话修复，不能仅以 XML 投影相等宣布排版通过。

首轮时 D02-B 代码及测试已通过，等待最终引擎产物联合复核；当时 D03 仅做只读接入设计：沿用同一 `diagrams.document`、ID、修订及工作区组织，增加格式判别，不另建独立图形库、不自动迁移旧数据。最终决定见下文。

### D02 最终验收决定

**通过 D02 指定范围，退回项已修复。** 项目经理检查实际源码、报告和修复后的 PBS/长文字图片，独立运行：

- `npm.cmd test`：106/106 通过，无跳过。原有 80 项保持通过，新引擎 14 项、项目模型 12 项已接入默认入口。
- `npm.cmd run build`：通过；应用仍为 0.6.0。
- 最终两个目标测试文件重跑：26/26 通过。
- `node --import tsx scripts/probes/drawio-engine-browser.mjs`：PBS、普通泳道、长文字三样本真实加载、原生保存、独立回读及 PNG/SVG 导出通过。规范化几何变化均为 0，外联/请求失败/页面异常为 0；保留已知本地 `/drawio/null` 404 记录。

日志在 `output/playwright/project-manager-d02/`，独立探针产物已复制到其 `native/` 子目录。受限环境首次浏览器回环请求被拒绝后，按同一命令获自动审批重跑成功；没有将失败运行当作通过。

验收覆盖内容/渲染分层、原生泳道与绑定、严格 v3 校验、安全 XML、局部文案修改和原生保存往返。当前不支持的方向/线路/note形状等显式拒绝；已实现的 note 默认样式不被误禁。PBS 来源质量问题保留，密集执行区少量线路/标签交叠、长文案替换扩容、结构操作、保存会话与正式后台导出继续由 D03/G1/D04 处理，不宣称 G1 或最终集成通过。

### D03 本轮派单

复用同一对代理，先做 A1/B1 两个独立子批次，再接 A2/B2 的 DrawioHost、原生图形库、保存队列和恢复草稿。A1 所有权增加独立 profile/偏好校验模块及 `engine/project.ts` 的校验抽取；B1 此轮不改 engine、现有 Vue/UI、共享类型、package 或文档台账。

共同接口：`normalizeDrawioEdits(xml, base: DrawingProjectV3): Promise<DrawioProjectionResult>`。服务器必须再次规范化/投影并正式校验后保存；`projectDrawio` 仍为严格解析，不以 base 内容覆盖人工修改。新增业务意图必须明确，无绑定普通形状仍作装饰。复制按原生 cell 身份建立新业务 ID 和内部连线映射，不改原对象。

B1 使用同一 SQLite 和图形身份；异步校验在事务外，事务内复查格式、删除状态、revision 并 CAS 写完整 v3 和历史；无修改不加修订，旧入口不能降级覆盖。新增 API 先由默认关闭的 native pilot 能力开关隔离，测试必须明确独立数据根，禁止指向当前 `data/`。D03 阶段不自动迁移旧记录，正式 v2→v3 仍在 G1 后 D06 执行。

项目经理另完成 [D03 接入能力预检](validation/drawio-host-capabilities.md)：真实原生内联业务库在 offline 模式可插入带业务类型的形状；空闲状态 metadata merge 后非零滚动和可操作选区保持。该证据不代表并发输入/保存队列安全，已明确告知 A2 不可用旧完整 XML 确认覆盖新编辑。探针不接触应用数据库。

### D03-B1 验收决定

**通过存储与隔离 API 指定范围。** 项目经理检查 service/store/路由、隔离保护、事务与响应代码，独立执行 `node --import tsx --test tests/drawio-native-storage.test.ts`：10/10 通过，含真实 HTTP、Host/Origin、默认关闭、mixed 读取、CAS、幂等、no-op、删除恢复及事务失败回滚。日志 `output/playwright/project-manager-d03/native-storage.log`。另实际浏览器复用资源 router/CSP 的功能探针通过。

初审要求补强的三项已经实现并有针对证据：工作区身份是 SQLite metadata 中随机持久 UUID 的摘要，同路径换库身份不同；store 在事务中复核真实无修改，不能信任调用者布尔值；native 修订冲突明确 `REVISION_CONFLICT/currentRevision`。旧 SQLite 3 项及目标 TypeScript 检查由开发代理实际运行通过，详见 [存储报告](validation/drawio-native-storage.md)。

A1 仍在完成原生结构编辑矩阵，整个 D03 尚未通过；旧 UI 尚未接入 mixed workspace，v3 暂无正式图片导出。默认入口及生产数据未切换。最终联合回归在 A1/B2/Host 集成后由项目经理执行。

为复用同一代理并推进阶段内独立工作，B 在 B1 验收后先实施 B2a：纯 client/session/IndexedDB 草稿基础和测试，不提前改 Vue 或引擎。它依赖的 B1 请求协议已经稳定；A1/Host 未验收的交互不写成已完成。

### D03-A1 验收进行中

项目经理检查真实编辑探针通过鼠标/键盘操作而非伪造 model 变更，独立重跑：37 项当时已落盘引擎/项目/编辑测试通过；原生拖入、复制、跨角色/阶段移动、hover 连线、归一化、两轮结构 patch、重新加载保存与 PNG/SVG 导出通过。检查截图，产物复制到 `output/playwright/project-manager-d03/native-editing/`。

随后将新编辑/存储测试纳入默认 `npm test`，在代理继续补充边界用例时完成全套运行：129 项中 128 通过，1 项新增加的“无阶段→首次阶段→删除最后阶段”失败。原因是 `changes.phaseId=undefined` 在 JSON 快照中被省略，无法显式清空归属；不能靠去掉用例过关。已要求原代理提出并实现最小语义操作协议修复、真实 schema 和文档同步，再重新验收。日志 `output/playwright/project-manager-d03/test.log`；A1 暂未通过，整个 D03 继续进行。

### D03-A1 最终验收决定与 A2 派单

**通过 A1 指定引擎与操作契约范围。** 项目经理检查 core/layers、update-only schema、guide 和保留的失败用例：实际 JSON `phaseId:null` 清空后删除最后阶段，完整内容/add 和必填字段拒绝 null，存档省略被清除字段。独立 `npm.cmd test` 首次 130/131，唯一失败为隔离 HTTP 的回环 health 超时；按同一命令获自动审批后重跑 **131/131，无跳过**。日志分别 `output/playwright/project-manager-d03/test-final-a1.log`、`test-final-a1-approved.log`。独立 `npm.cmd run build` 通过，日志 `build-pre-host.log`。

此前真实鼠标/键盘编辑与 PNG 复核证据继续有效，null 命令修复未改变几何模板，未重复无关视觉探针。详见 [A1 报告](validation/drawio-editing.md)。PBS 密集连线仍有局部交叠，G1 继续验收，不能称整体质量或 D03 全部通过。

继续复用原 A 执行 A2：独立安全消息控制器、DrawioHost.vue 和 inline 原生业务图形库；不改 B 保存队列、服务和 NativeStudio。初始 XML 只在会话打开时 load，确认保存不 reload/fit；捕获当前 XML 使用公开 export xml，关联当前会话，禁止旧快照覆盖新输入。B2a 继续处理并发恢复草稿的分叉身份并自测，之后再接 NativeStudio。项目经理补充 Vite `/drawio` 同源代理，默认入口和正式数据仍未切换。

### D03-B2a 验收与 B2b 派单

**通过纯保存会话和草稿仓库契约范围。** 项目经理检查队列、故障/关闭时序、client 错误及恢复逻辑，独立 `node --import tsx --test tests/native-session.test.ts` **18/18 通过**；单独 TypeScript 检查通过。日志 `output/playwright/project-manager-d03/native-session-initial.log`、`native-session-types.log`。新测试已加入默认 npm test，后续联合回归执行。

初审发现同一源草稿双标签恢复共享 sessionId 的风险，原 B 已按要求改成全新 sessionId 分叉，原未确认请求保持不变；测试证明单个分支确认不能删除另一分支。源草稿保留，由 B2b 低频菜单显式移除，不自动重放。真实 IndexedDB 事务、下载、Vue/Host、输入法和视角仍未通过，本阶段不以内存仓库测试代替浏览器验证。报告 [保存会话核验](validation/drawio-save-session.md)。

继续复用 B 执行 B2b：独立 `/native` pilot 薄页面集成 A2 Host 和保存会话，默认旧入口不变，生产数据不迁移。另发现普通 flush 只在打开/retry 校验工作区、请求不携带身份，后台换库同 ID/revision 时可能误写；B2b 同步补充绑定不可自动更换的工作区请求身份，并由服务端在 native mutation 前校验，不能仅靠 health→save 两次请求。Host 组件由 A 独占，B 不改消息控制器。完整组织交互仍由 D08 处理。

### D03-A2 验收决定

**通过 Host 与原生业务库指定范围。** 项目经理审查消息 origin/source、固定动作、请求关联/超时、挂载生命周期和独立说明样式；原 note 颜色顺序覆盖问题已退回修复。独立目标测试 **55/55**，日志 `output/playwright/project-manager-d03/host-tests.log`，Host 14 项已加入默认 npm test。

独立使用项目新固定的 Playwright core 1.62.1 + Chromium headless shell **151.0.7922.34** 重跑真实 Vue Host 探针通过。初次受限回环请求失败，获自动审批按相同命令重跑成功；日志 `host-browser-fixed151.log` 和 `host-browser-fixed151-approved.log`。实际查看截图，原生库拖入/复制/连线/文字、metadata 保留、状态更新不 reload/fit、选区与非零视口保持、显式提交与未提交检测、浮动说明不撑阶段、旧 source 及 pending 隔离通过。证据复制至 `output/playwright/project-manager-d03/host-fixed151/`。

普通 capture 只读已提交模型；导航新增显式 commitAndCaptureXML，仅允许 invokeAction/save，普通 autosave/确认不会触发它。固定版本 DOM 只读检测用于 unload 风险提示，不扩展为自研编辑系统。截图中的复制偏移/手动拖入位置保持；不是全图重排或复杂 PBS 的质量验收。OS 输入法尚无真实 OS 自动化全覆盖，浏览器 composition 模拟边界在 [Host 报告](validation/drawio-host.md) 中明确；B2b 继续实际保存/恢复/切图联调。

项目经理还完成 [固定浏览器与字体供应准备](validation/drawio-runtime-supply.md)，仅资源和实际 launch，D04 worker 尚未开始。A 保留原会话，不销毁重建；B 完成 B2b 后先联合验收 D03 再推进 D04。

### D03-B2b 与阶段联合验收决定

**通过 B2b 及当前原生泳道的 D03 阶段基线。** 项目经理审查页面/队列/事务内身份 guard、IDB 精确清理和真实探针。独立默认 `npm.cmd test` **165/165 通过，无跳过**；`npm.cmd run build` 通过，日志 `output/playwright/project-manager-d03/test-joint.log`、`build-joint.log`。随后在该构建上独立运行 `node --import tsx scripts/probes/native-studio-browser.mjs`，固定项目 Chromium151、真实 Runtime/临时 SQLite/IndexedDB，**21 项通过**，无页面错误和外联；日志 `native-studio-browser.log`，复制证据到同目录 `native-studio/`，并实际查看保存后截图。

审查退回的混合旧图入口、抓取失败继续导航、旧快照下载、配额不足无法下载最新模型、413 卡住未确定队列均已修复并有针对验证。换库保护在异步校验后的 SQLite 短事务重新核对身份，错配不能重放旧回执或产生 revision/history/receipt。真实慢 A/B/C、非零视口/选区、原生拖动和连线、切图迟到、并发恢复分叉、下载/精确移除、外部409与quota事务故障通过。

范围与限制见 [工作台报告](validation/native-studio.md)：v2 未迁移只读；冲突/删除提供恢复下载但未支持任意 XML 另存新 ID；五类模板、MCP质量准入、正式迁移/组织管理分别由后续阶段完成。受控 quota 与 composition 不能冒充物理磁盘耗尽或真实 OS 输入法验证。当前默认入口和正式库仍未切换，D03 通过不等于 G1/G2。

项目经理下载官方 31.5.3 WAR，对照 GitHub release SHA-256，并实际比较现有 vendor **3446 个文件，缺失/多余/哈希差异均为0**；原“官方归档真实性未核实”部分已经补证，完整分发许可仍保留为发布门槛。D04 继续复用原两代理，A 负责独立 renderer/字体/供应，B 负责不可变任务/发布/读取，避免同文件并发覆盖。

### 项目经理独立基线检查

日期：2026-10-16。

- 先检查测试使用临时数据目录，未向用户当前数据库运行测试写入。
- `npm.cmd test`：80 项通过，0 失败。日志：`output/playwright/project-manager-baseline/test.log`。
- `npm.cmd run build`：通过。日志：`output/playwright/project-manager-baseline/build.log`。
- 上述为迁移前现有应用回归，不代表新 draw.io 引擎或最终集成测试通过。
- 两个代理使用不重叠的检查脚本/证据文档，原业务代码和用户数据库尚未进行迁移。

### D01-A 验收决定

**通过指定核验范围。** 项目经理检查报告和探针实现，独立重跑供应清点并断言清单 SHA-256 为 `8058e2e08598ba92c2d0b8191070dac8ee37c4df141c1eed62aefbba49c0cdc4`；核对 `protocol.json` 的实际 configure/init/load/save/autosave 和四类导出，打开 `editor-loaded.png` 检查原生编辑器及中文显示。

确认固定本地版本 31.5.3；export 自定义关联值位于 `event.message.message`，xmlsvg 回复 format 为 svg，后续宿主必须按实测处理。原始官方归档真实性、可分发中文字体/固定 Chromium 和复杂二维容器仍待后续验证，不作为已完成能力。证据见 [供应报告](validation/drawio-supply.md)；独立清点日志在 `output/playwright/project-manager-baseline/supply.log`。

### D01-B 验收决定

**通过指定核验范围。** 项目经理检查脚本未调用正式 DiagramStore.init/migrate、备份输出位于已忽略目录，检查来源/脱敏字段及关系清单；独立运行 `node scripts/check-drawing-data.mjs --fixtures-only`，六份夹具均符合来源基准；另直接以只读方式打开在线备份，`integrity_check=ok`、外键问题 0、44 图/8 活动，与报告一致。

最新开发证据在 `output/playwright/drawio-data-baseline/2026-10-16T04-29-35.163Z/report.json`；项目经理另核对前一次独立副本 `2026-10-16T04-26-02.914Z/online-backup.sqlite`，两轮统计一致。源、备份、恢复逻辑一致和源主文件未变有报告记录；SQLite WAL/SHM 协调文件副作用已明确，未将其表述为整个目录零变化。

PBS 夹具机器分 38，其余五类基础夹具 100；基准中的业务异常保留，不伪造条件和连接，不认定为 PRD 质量通过。三份旧样本时间差异也保留。完整制品恢复、生产切换、五维人工评审及 G1 仍未验收。详情见 [数据基线](validation/drawio-data-baseline.md)，独立夹具日志在 `output/playwright/project-manager-baseline/fixtures.log`。

### 后续交接

- 两个代理保留原会话，当前派单为 D05-A/B；D03/D04 的最终验收见各节。后续仍通过原任务名复用。
- 项目经理已定义 `src/drawing/engine/types.ts` 共享契约。引擎负责 XML，项目模型负责内容哈希与投影一致；两者通过独立哈希模块避免循环依赖。D03-A1 统一 profile 能力校验，并提供 `normalizeDrawioEdits` 给 B1 服务调用，B1 不改 engine。
- 引入固定 `@xmldom/xmldom 0.8.15` 和 `elkjs 0.9.3`，应用版本不变；用于 XML 安全解析与成熟布局组件，不扩展自研白板。离线缓存缺失后已获自动审批下载，安装完成且依赖审计无漏洞。
- 既有 80 项回归和构建通过仅为迁移前基线，不能替代 G1/G2。

### D04 中间审查（尚未阶段验收）

项目经理检查不可变快照、五制品发布、SQLite 租约及下载鉴权。初审发现硬超时只覆盖渲染，未覆盖文件准备/发布，已退回 B 修复为完整流水线截止时间，并在 SQLite 获得事务后再次检查真实时钟。新增准备停滞、发布停滞、事件循环阻塞及双 worker 抢占用例。独立 `node --import tsx --test tests/native-exports.test.ts`：沙箱首次原子 rename 被 EPERM 拒绝；获自动审批按同一命令重跑 **10/10 通过**。此为任务/存储契约验证，不代替真实 draw.io 输出、Web 导出交互或 D04 阶段通过。

A 的实际原生 SVG 导出暴露了同一 OTF 随四种兼容字体别名重复嵌入的问题（混合样本约 88 MB）。已批准只对 SVG 字体资源做规范化封装并单次内嵌；源 XML、业务、文字、几何和颜色不得修改，未知字体仍显式失败。性能及离线图像对照待完成，不以原始重复嵌入结果作最终承诺。B 补充 Runtime 的正常关闭与仅父子进程 IPC 的探针停机，不增加 HTTP 停机接口。

### D04-A 验收决定

**通过固定供应与原生 renderer 指定范围。** 项目经理独立 `npm.cmd run check:runtime` 核验本项目 3446 个资源文件、字体及实际浏览器；独立 9 项 renderer/SVG 单测通过。实际审查字体封装只改已供应别名与内嵌资源，不改源 XML、文本、几何和 paint。开发前后离线截图、PNG 字节和字体摘要对照见 [renderer 报告](validation/drawio-renderer.md)。

独立执行 `node --import tsx scripts/probes/drawio-renderer.mjs`：沙箱首次回环访问被拒绝，获自动审批同命令重跑退出 0，10 个真实样本、8 个故障/中断及之后新快照恢复通过；实际查看 PBS PNG。独立冷 5382 ms，三暖观测 P95 4674 ms，混合别名 7016 ms；仅为本机少量样本，不是生产性能保证。固定字体 SVG 从原混合约 88 MB 降为约 22 MB，未知字体仍明确失败，透明/白底及完整范围降比通过。证据 `output/playwright/project-manager-d04-renderer-approved.log`、`project-manager-d04/renderer-report.json`、`pbs-native.png`。

独立联合回归首轮 183/184，故障注入测试的 100 ms 截止时间在进入目标阶段前耗尽，已退回 B 改为足够前置预算和真实 wall-clock 等待，不放宽生产截止时间；最终默认 `npm.cmd test` **184/184 通过，无跳过**，`npm.cmd run build` 通过。日志 `output/playwright/project-manager-d04-test-final.log`、`project-manager-d04-build.log`。独立无用户页面 Runtime 的六组检查及两次正常退出也已通过，`frontendPagesOpened=0`，结果 `project-manager-d04/runtime-result.json`；B 工作台导出交互仍待最后独立验收，当前不据此提前通过整个 D04。

### D04-B 与阶段联合验收决定

**通过 D04 同引擎后台导出指定范围。** 项目经理在最终源码再次构建通过，并重跑最终 10 项任务测试通过（修正故障测试窗口与进入检查点，生产 deadline 未放宽）。在该 dist 独立执行 `scripts/probes/native-export-browser.mjs`：5 组检查全通过，真实活动文字提交→保存→五制品、PNG 下载、保存失败不导出/不提供旧文件、最新恢复下载及精确重试后新修订导出，页面错误/外联均为 0，正常停机。实际查看成功截图。日志 `output/playwright/project-manager-d04-{build-final,export-tests-final,browser}.log`；证据 `project-manager-d04/{runtime-result,browser-result}.json`、`export-success.png`、`save-failure.png`。

不变快照、文件名/mtime 的导出时间、文档时间不变、历史修订标识、原子发布后登记、读取摘要、租约/超时/重试和正常关闭已经验证。默认测试已纳入新增 19 项，联合 184/184 无跳过；供应、字体封装和性能限制见 A 决定。此阶段是 HTTP/后台/原生工作台链路，真实 STDIO MCP 与两轮人工/AI 交替仍为 D05/G1，未提前通过。默认入口、正式 SQLite、应用版本均未切换。

复用两原代理进入 D05：A 负责按需启动、单实例与本机握手；B 负责共享应用服务、原工具名 MCP、严格质量及已保存/导出状态。A 独占 runtime 生命周期装配，B 独占 native API/MCP；共享契约先由 A 提议、PM 确认，不并发修改同文件。不新建或销毁代理。

### D05 派单与接口决定

A 的启动/认证方案已经项目经理批准：`ensureNativeRuntime` 连接返回 baseURL/dataRootId/instanceId、能力、认证 fetch 和仅客户端 detach 的 close。原子占用与端口绑定在 SQLite 初始化前；同根复用、错根/错版本/外来服务拒绝，失效锁复核 owner，不终止他人进程。凭据使用 OS 用户私有目录，测试只用可注入临时私有根；nonce/HMAC 确认实例后才发送 Bearer。pilot 数据与下载鉴权，Web 通过受控 Origin/Host bootstrap 取得实例 cookie。A 独占 runtime/start、NativeClient 和健康/会话类型，以及既有 raw API 测试的启动鉴权 helper。

B 的准入方案已经批准：人工 create/editor-save 保留结构草稿，新增明确 AI create/patch/update 路由，在同一应用服务执行质量检查；AI/人工 mutation 哈希作用域不能互相绕过，editIntent 纳入幂等。MCP 保留原工具名，native 分支不得先执行旧 store.init；已保存而导出失败单独返回保存身份和任务，不能重建或返回旧图片。暂时不具备安全视觉 patch 时 `configure_rendering` 明确不支持，D07 必须补齐；不伪造测量尺寸、模板或配置效果。真实 STDIO、自动启动、退出复用与两轮交替仍未验证。

审查进一步批准指定历史修订导出：保存回执 r1 已成功但导出入队前断线、当前已到 r2 时，原当前 CAS 导出不能补 r1 任务。B 负责新增服务器按同库 history 冻结指定 v3 的入口，事务复查历史/身份/存活，保留原当前导出 CAS；MCP 稳定派生 export requestId，所有回执元数据与图像锚定 r1，另明确当前修订。该扩展待实现验证，不将断线重试变成新建图形。

批准 A 的显式停止窄接口：Windows 无法用 SIGTERM 证明优雅关闭，ensure 后已断开父子 IPC，也需要为自有临时后台提供正常清理。pilot 的 `/studio-api/runtime/shutdown` 仅接受 Bearer 加精确实例/工作区身份，cookie 不足；helper 独立于仅 detach 的 close，MCP 退出不调用、不新增 MCP 停机工具。测试只能停止自己启动且已记录身份的实例。先前禁止未认证 HTTP 停机的约束继续有效，未扩大为任意进程终止能力。

### D05 中间审查（尚未阶段验收）

- A 的恢复锁在 mkdir 后、owner 写入前崩溃会永久留下空 guard，已退回补充宽限/稳定 owner 复核的恢复；活 PID/未知 owner 仍保守拒绝。启动监听安装过晚、首个启动失败继续重试、bind 后或 store.init 失败漏端口/锁，也已要求修复并增加受控用例。旧 `/artifacts` 在 pilot 不能绕过数据下载认证。
- B 的 mixed 读取原本把 v2 全文档作为 content 返回，已修为 extractContent；v3 只有正式投影验证后才标 synced。完整 update 使用语义差异和最终投影一致断言；质量策略比较全部 severity 及可测规模，改善错误为警告不误报新增，原子问题按对象存在比较。
- MCP facade 原先误按嵌套 error 读取 HTTP 响应，会吞掉 QUALITY_FAILED/CAS 定位，已修为真实 `{error,code,currentRevision,quality}` 契约。默认等待须在常见客户端请求期限前返回已保存/任务状态，不能用测试中延长超时掩盖。正式内容标准资源复用 drawingStandard()，不拿短 guide 摘要冒充标准全文。
- 项目经理已独立执行 native-ai **7/7**、SDK in-memory native-mcp **5/5**、runtime-instance 初始 **6/6**；后者日志 `output/playwright/project-manager-d05/runtime-unit-initial.log`。这是模型/服务/契约/受控锁测试，不代替真实 STDIO、真实同根并发单实例、实际 Chromium 图片或最终集成。A/B 仍在实现和真实联调，D05 未通过。
- B 首轮真实 STDIO 用 64 MiB 自定义 buffer 读取了约 22 MB 字体 SVG，不能当作默认 SDK 通过。项目经理查本地 SDK 确认默认 10 MiB 后要求改用默认客户端复测；批准固定 8 MiB 最终 JSON 预算、超大资源可控错误/连接继续可用、PNG 预览状态与导出状态分开、带 size 的预算内资源链接及所有真实本机文件/下载保留。SVG 实体通过文件/认证 HTTP 摘要验证；不伪造默认内联可读，也不改字体或裁图绕过预算。此修复与 probe 待验收。

### D05-B 验收决定与联合退回

**通过 B 指定应用服务与 MCP 范围，D05 阶段尚未通过。** 项目经理检查真实代码、AI 质量/diff、错误/幂等和包大小边界；新增三个稳定测试文件已纳入默认入口。独立在默认 SDK（没有扩大 maxBufferSize）执行 `scripts/probes/native-mcp.mjs`，**15 组全绿**：真实 PNG/五制品、受控原生 XML 保存后读/patch、无关人工几何保留、历史回执/幂等/CAS/质量/删除、同实例重连、SVG 超大可控拒绝后连接继续可用，以及本机/HTTP/manifest 摘要一致。`mcpStderr` 为空，后台正常退出，临时根清理成功。此处受控 XML 保存不是指针交互，不冒称 G1。

独立最终构建通过；在该 dist 执行 `scripts/probes/native-mcp-deeplink.mjs`，**4 组全绿**，固定 Chromium151、错误/外联为0，未迁移/缺失/已删除不伪打开或重建，正常退出并清理临时根。项目经理实际查看真实生成 PNG 与定向选图截图。日志 `output/playwright/project-manager-d05/{native-mcp-probe,native-mcp-deeplink,build-joint}.log`，复制结果/截图在同目录。独立生命周期探针增加旧浏览器崩溃退出后 **13 组全绿**，`runtime-instance-result.json`，0用户页面，正常临时清理。

联合 `npm.cmd test` 首轮 **209/210**；唯一失败是 A 的坏 SQLite 启动失败用例，private 临时目录清理出现 ENOTEMPTY。已退回 A：接到 runtime-error 时子进程仍可能输出 stderr/退出，不能只凭锁/端口已清便返回。需有限等待本次子进程 close 后返回失败，并以延迟 close 夹具和返回时 PID 已退出证明，不能仅加 rm 重试掩盖活进程。日志 `project-manager-d05/test-joint.log`。修好后项目经理重跑联合回归，再决定 D05/G1，不重复已稳定的无关大探针。

进一步关闭两条已定位失败路径：A 在 Runtime 已启动 worker 后写就绪凭据失败时，startup catch 也必须先关闭 worker/renderer，再 finally 关闭本实例 HTTP/锁；不能只关闭 boot 留活浏览器。B 成功 connection 缓存不能在后台停止/重启后永久沿用旧 token；统一请求 helper 在网络失败/401 时只使对应旧缓存失效、首次不自动重放不确定写，下次相同 key/payload 重新 ensure。首次绑定的 dataRootId 不可变化，新实例同库可恢复，同路径换库拒绝；迟到旧失败不能清掉新连接，CAS/质量等业务错误不重握手。这两项等待原代理窄修及实际证据，当前仍不通过 D05。

### D05 最终验收与 G1 派单

**D05 指定 Runtime/MCP 范围通过。** 项目经理复核 A 的 startup catch 先关闭 worker、后关闭 boot，以及仅有限等待自己失败子进程退出的处理；复核 B 的请求统一入口、首次工作区绑定与旧 Promise 失效守卫。独立 `npm.cmd test` 沙箱首轮 200/216，临时原子 rename 等受 EPERM 拦截；保留日志，获自动审批按相同入口重跑 **216/216，无跳过**。独立构建通过。日志 `output/playwright/project-manager-d05/{test-final,test-final-approved,build-final}.log`。

独立真实默认 SDK `scripts/probes/native-mcp-recovery.mjs` 沙箱首次锁 rename 被 EPERM 拒绝，审批同命令后 **5/5 通过**：同一 STDIO 进程在后台停止后首次失败不重放、下一次同 requestId 启动同库新实例并复用 revision/job、同路径换 workspace 拒绝且零写、持续保持原绑定。stderr 空、正常停机、临时根清理成功。证据 `project-manager-d05/mcp-recovery-result.json`、`mcp-recovery-approved.log`。前序 15 项实际 MCP、4 项深链路和 13 项生命周期证据继续有效，不重复无关大探针。

G1 复用原两代理：A 独占可组合真实 DOM/指针/键盘 helper，B 独占同 Runtime/真实 STDIO 的 `native-g1.mjs` 编排；只在临时根工作。先分别证明合格工业泳道的纯内容 AI 新建，以及历史 PBS 草稿的复杂编辑往返。历史缺陷保留，新增测试业务步骤是明确演练要求，不冒称来源业务修复。必须按两轮 UI→保存→最新 MCP 读取→实际结构 patch 交替，检查无关人工几何/线路/样式，再关闭用户页面导出、复开、并发冲突及真实 worker 失败恢复。受控 XML 故障注入单独标识，不冒充手势。此刻 G1 尚未验收，D06–D09/G2 待依赖通过。

### G1 首轮定位

B 首轮组合保留 `output/playwright/native-g1/` 失败证据：文字保存到 r2，但 round1Human 的 moveResize 等待目标修订超时，最初按容器误选定位。PM 要求原 A 修真实目标/把手定位、B 增加仅 round1 的窄复测入口；不加超时掩盖未执行动作，不据此提前判为产品保存错误。后续实际 DOM 确认缩放为 input.geZoomInput，且 50% 下业务节点能被选中，但原生 manageSizers 隐藏四角，只显示外扩的侧把手；因此“无角把手等于没选中”也不成立。已经要求改用实际业务 selection rect 和可见 E/S resize 控点，并以公开保存 XML 的几何及最新 API 数据检查。此结论仍待真实通过，不用旧 D03 的仅 revision 增长旗标替代位移断言。

为减少反复启动，批准仅 round1 的有限同页诊断：只接受固定忽略目录 retry/stop 信号，10 分钟总寿命，固定 helper 热载，无产品接口/任意脚本；最终成功/停止/过期均正常清理自己的浏览器/Runtime。最终正式 G1 必须在全新临时库运行完整两轮。失败临时根保留供定位。复杂执行区回流标签的视觉拥挤另在本轮检查，投影等价不能代替视觉通过。

开发同页窄测现已通过，PM查看 `native-g1-round1/ui-round1.json` 的实际动作：n02 从 `(50,246,260,64)` 到 `(8,286,292,80)`，n06 从 `(50,206)` 到 `(18,230)`，均来自公开保存 XML/API 几何；最终 r8、ack 视角/选区不变、正常退出并清理临时根。仅代表窄测证据已核对，不等于 PM 独立运行或 G1 已验收。B 正用冻结 helper 在全新库运行完整链，A 暂不改同一 helper。

### G1 真实编辑进展与视觉退回

完整新库首次已通过 UI1→MCP结构1：r6人工编辑、r7插入测试步骤/重连并返回真实 PNG，无关节点几何保留；UI2复制跨角色/阶段及第一条真实连线已保存，第二条手势因既有边选区/浮动工具干扰而出现断端，服务拒绝 `DISCONNECTED_BUSINESS_EDGE` 并保留草稿。B/A 获准在全新临时库通过正式 manual/editor-save 装载固定 AI1 检查点，只窄测 UI2；该受控装载不冒充完整人工路径，最后仍须全新全链运行。连接箭头必须按真实 DOM 定位，不能混选其他 title 图标。

PM 另要求两次 AI 后比较全部未受影响既有 edge/decoration 的 parent、geometry、style；两个节点签名不能代替折点/装饰保留。必要容器变化独立列明。

B已对现有UI1 r6→AI1 r7检查点实际补查88个既有cell，包括25条未改边和24个装饰，仅排除e02，签名通过；此为当前检查点补证，正式新库完整链仍须运行同断言。UI2第二连接的真实未保存XML已定位为新边source正确而target空，服务拒绝断端是正确行为，A/B继续按真实DOM处理连接手势。

**G1-V 视觉退回：** PM实际查看 `native-g1/ai-round1.png`，A 原生 SVG/路径定位确认 e02 终点由 n03 改测试步骤后，旧右出/左入及 offset(0,-18)仍沿用；“必选指派”基线与 n16 正文几乎同位，路径横穿 n16。D04原始执行区 e12/e17 标签中心差12px、小于15.6px行高，另共用竖轨穿标签；此区 AI1 未变，是首次模板问题。e03 因人工移动/增高 n02 后进入框底部单列为人工结果，不暗改无关边。证据在 `output/playwright/native-g1-visual/`，A先交窄方案，PM确认后才改引擎；不全图重编译、修业务或引入白板基础交互。此刻不通过 G1。

PM已核对固定vendor的 `js/libavoid-js/README.md` 与共享routing core头，批准A先最小API验证，成功后复用本地pure-JS libavoid/官方computeRoutes做窄适配；无新依赖、无CDN、不改vendor。新增及真实端点改变边重新计算，全部当前业务框作为障碍，不移动节点，保留其他边/装饰；首次compile按文本范围与行高泛化分配标签位置，禁止硬编码PBS IDs。Node loader不得顶层侵入Vue投影路径；就绪/资源释放/失败明确、原始供应hash与许可来源入报告，V04正式分发授权仍未完成。R1人工测试dy从40改20保留净距由A统一改helper，B继续R2-only诊断、等待引擎冻结后才重跑全链，避免无效重复导出。

文件归属已经调整以并行：A独占engine/routing、首次模板及其报告，可改g1-ui-scenario的明确R1参数；B独占native-editor的connect窄修及编排，稳定R1函数不并发改。

PM独立 `node scripts/probes/g1-routing-smoke.mjs` 退出0：固定JS/许可hash、实际ready与官方API存在、三障碍单边正交避障、router创建/释放1/1，约55.7ms。日志/复制结果 `output/playwright/project-manager-g1/{routing-smoke.log,routing-api-smoke.json}`。此为API验证，不是完整模板/patch已修好。

R2-only窄测开发已通过，PM核对 `native-g1-round2/{result.json,ui-round2.json}`：固定v3检查点通过验证并受控载入至r2，实际副本取得新businessId/cellId、归属r02/p02，两条真实连接n02→副本→n03有完整cell端点，临时副本Delete，最终r7、正常退出/清理。该受控载入明确不是从原始新建开始的完整人工路径；正式全链仍待A路由/标签冻结后执行，B已暂停其他探针。

### G1-V 指定范围验收

**通过局部路由与首次模板标签指定范围。** 固定本地官方libavoid求解边折点，不移动节点；既有图只改新增或端点ID变更边，清过期路由约束，其他cell保留；旧标签/路径只读占位。维持500节点/2000边预算，原生自环分支使用draw.io loopStyle并核对真实U形；无安全空间明确失败。内容不新增坐标、美化描述。

首次真实渲染曾触发 `NATIVE_DOCUMENT_CHANGED`，精准差异为mxGeometry子元素顺序（native codec先offset再Array），已只修新输出顺序，未放宽renderer签名。开发32项目标回归通过；PM独立 `npm.cmd run build` 通过，独立 `g1-routing-renderer.mjs` 三样本退出0，全部内容hash/严格render签名往返一致、88旧cell保留、自环真实SVG正交且不穿邻接节点。PM实际查看fresh/patched/native-loop PNG：首次执行区标签改善，重连e02穿n16及叠字消除。结果与图片复制在 `output/playwright/project-manager-g1/`；耗时仅本机少量样本，不作性能保证。许可正式分发V04继续保留。

PM联合 `npm.cmd test` **218/219**；唯一失败为旧 `drawio-native-storage` 身份更换用例递归删除已关闭临时SQLite目录时 ENOTEMPTY，日志 `project-manager-g1/test-routing-final.log:507`。该用例没有子进程，store连接均同步finally close；已交B改受控目录替换/有限Windows清理，不修改生产store、不忽略真正失败。G1整体仍未通过。PM三样本已结束，可在fixture窄修后由B运行一次fresh完整链；A代码冻结等待复用。

D07另需验证AI改lane/phase/节点尺寸后受影响incident边的路线；当前路由修复只覆盖新增/端点ID改变，不提前称全部渲染变化自动避障。G2真实线段/标签拖动等仍按最终矩阵验收。

目录测试窄修已由B交验，PM审查仅测试文件变更：已关闭identity目录在同父临时根内rename为retired，再在原路径初始化新workspace；路径guard和新旧dataRootId不相等断言保留，有限清理重试不忽略持久错误。PM独立最终 `npm.cmd test` **219/219，无跳过**，日志 `project-manager-g1/test-final.log`；构建及3真实样本证据继续有效。

新路由fresh组合又停在UI2第二次连接。B实际截图确认copy约y1180在canvas底1068之外，而目标n03约y898可见，属于两端滚动准备问题，不是产品不支持连接。已批准仅connect按两端DOM bbox与canvas联合可见性、有限真实wheel滚动后重取点；不换目标、不模型写。先以新AI1检查点做R2-only，再完整fresh。G1仍未通过，不能以UI窄测累计次数或绿色单测替代全链。

### G1 第二轮选择与连线窄修

新路由下两端联合可见性准备已解决视口外连线；随后定位固定“空白”点击在滚动后实际命中标题，导致 Ctrl+D 同时复制标题并正确触发 DUPLICATE_BINDING。B 已改为固定 vendor 的公开 Ctrl+Shift+A 取消选择，再用实际蓝色业务选框校验唯一业务选区；不把灰色父格提示框误判为第二个业务选择，不改内部 graph/model 或投影约束。

B 同页 R2 窄验通过真实跨角色/阶段复制、两条端点连接、临时节点复制和 Delete；诊断重试遗留的断端草稿保留，显式重读远端后才重试，不把清理残留当作正式完整路径。最终 r11、正常停机并清理临时根。此为窄诊断证据，当前正在全新临时库执行完整 G1，仍待开发回报及项目经理独立运行。原 A 冻结等待复用，原 B 继续编排；不新建代理。

### G1 项目经理最终验收

**G1 技术贯通门槛通过。** PM 独立执行 `node --import tsx scripts/probes/native-g1.mjs`，沙箱首次在隔离临时根锁文件 rename 遇 EPERM；同命令获自动审批后全新运行退出0，11项全部通过。PBS r1→UI1 r6→AI1 r7→UI2 r12→AI2 r13，两次AI修改均保留86个无关cell（25边、24装饰、3说明、20节点、10阶段与4角色绑定）；真实复制跨角色/阶段、两条连接及临时节点Delete均由公开UI操作完成。

真实409未覆盖远端，IDB草稿可下载；所有用户页关闭后后台导出、复开内容/原生几何一致。明确受控XML字体故障触发真实worker失败，已保存r15但无旧图/无重复创建；最新r17新任务恢复，原任务仍failed。页面错误、外联、MCP stderr均为空；后台正常退出，临时根清理成功。PM实际查看AI1、AI2和冲突截图，重连不再穿n16或叠其正文。证据 `output/playwright/project-manager-g1/{full-chain.log,full-chain-approved.log,full-chain-result.json,full-chain-ai1.png,full-chain-ai2.png,full-chain-conflict.png,full-chain-recovered.png}`。

已有219/219联合回归、构建及3样本真实路由渲染证据继续有效，不为helper窄修重复大范围测试。历史PBS的23节点/26边/38分及缺失来源条件原样保留；本次验收不替代D09业务质量评测，不覆盖真实OS输入法/物理磁盘满。默认入口、用户数据库、版本0.6.0未切换，无提交推送。

**D06开始，继续原两代理。** A负责纯迁移预览/转换及映射报告；B负责来源记录/CAS提交、在线备份与安全恢复。只在隔离副本试迁移PBS；四类尚未适配的图形保持可读并明确待D07，不静默重排或丢覆盖。共享接口由PM确认，恢复前后的新增编辑必须保留，旧客户端工作区身份不能继续写入恢复后的库。

### D06-A 独立样本审查

A纯迁移模块与报告已交验并冻结。迁移使用旧scene解释实际外观，新输出保持节点绝对box、原线路/端口/标签、阶段尺寸、锁及安全组合；未知或会被旧validator清理的覆盖明确blocking，无可提交project。复杂/横向及其他类型延D07，源时间/业务/历史不写。固定字体替换明确warning，不承诺旧字形逐像素相同。

PM独立 `node --import tsx scripts/probes/drawio-migration-native.mjs` 首次沙箱本机回环被拒，获自动审批同命令重跑退出0，PBS与真实旧编辑操作生成的手工覆盖两样本打开→保存→PNG/SVG通过，内容hash/严格native签名/所有节点绝对几何一致。PM实际查看两PNG；旧执行区密线按迁移原样保留，不冒称自动美化。证据 `output/playwright/project-manager-d06/{migration-renderer.log,migration-renderer-approved.log,migration-render-report.json,migrated-pbs.png,migrated-manual.png}`。

该实测定位并修复renderer将实体编码内部渐变url误当外部资源的问题：仅从严格解析后的DOM属性/style提取，仍拒活动SVG、外部url及import，固定字体SHA门槛不变。A目标27/27、构建自测通过；PM已把三个新增测试文件接默认入口，等待B冻结后联合回归，不以开发自测替代最终验收。

### D06-B 独立恢复演练与联合退回

PM独立 `npm.cmd run build` 通过；独立 `node --import tsx scripts/probes/native-backup-restore.mjs` 首次沙箱临时锁rename被EPERM拒绝，获审同入口新临时根重跑 **10/10**。覆盖PBS显式迁移同ID/原时间/来源、五制品、在线DB+制品+固定供应校验、旧恢复计划拒绝新增修改、保护较新的数据库/制品、旋转身份后拒旧客户端、mixed/history/group/trash/tombstone、原来源审计保留与回执epoch、恢复历史制品读取、新任务重新导出、再次备份验证来源绑定。0用户页，3个自有实例均正常退出、临时根清理成功；PM实际查看恢复PNG。证据 `project-manager-d06/{backup-restore.log,backup-restore-approved.log,backup-restore-result.json,backup-manifest.json,restored-pbs.png,build-final.log}`。

默认测试已包含3新增文件。沙箱首轮223/244，21项受临时rename/制品发布EPERM影响，正常结束172.6秒；保留 `test-final.log`。获审同完整命令重跑 **243/244，无跳过**，唯一旧Runtime端口占用用例收到子进程EPERM而非PORT_OCCUPIED（`test-final-approved.log:1142`）。该轮是真实批准环境，不能作为沙箱噪声直接忽略。已退回原A审生命周期、取私有启动诊断及窄修，禁止放宽错误期望/测试重试掩盖；B/迁移器冻结。未手动终止进程：只读查得旧测试PID30948后，它已自然退出。D06尚不通过，D07仅只读方案准备。

恢复当前仅离线维护CLI/服务，不宣称已接工作台活服务入口；D08/G2须完成该入口。备份携带固定供应指纹，需要匹配本地安装，不冒称自包含安装包。中断通过journal显式回退，真实断电/物理磁盘满未验证。

### D06 最终验收与 D07 派单

**D06 指定迁移/离线恢复范围通过。** 原A定向Windows持有owner文件且不允许delete共享，实际复现directory rename EPERM遮蔽PORT_OCCUPIED；原失败那次的私有日志已被当时finally清理，不能断言历史单次一定同因。窄修只对Win EPERM/EACCES/EBUSY释放自有锁最多750ms、25ms重读匹配owner后重试；bind/client失败保留原启动code，清理失败另记，不重试启动、不杀进程。PM复核代码与修前/后证据，最终独立 `npm.cmd test` **245/245，无跳过**，`npm.cmd run build`通过。日志 `project-manager-d06/{test-release-fixed.log,build-release-fixed.log,release-sharing-before.json,release-sharing-after.json}`。先前两真实迁移样本/真实恢复10项继续有效，不为锁窄修重复无关大探针。

当前仍未切换默认入口或用户数据库，无提交/推送/应用版本更新。离线维护与供应安装边界按报告保留，活服务恢复入口待D08/G2。

D07继续原两代理，分批实施：先五类业务profile/受控字段/泳道能力及服务接线，再原生configure与各型迁移，最后单页drawio导入和独立canvas-only。A独占engine与所需renderer适配，B独占应用服务/存储/路由/MCP/原生UI接线；共享契约先确认、禁止同文件并改。纯内容JSON与完整业务项目导入可先行，canvas-only明确无content/kind/假质量分，不冒充业务图或输出空content.json。多页/不支持压缩/损坏业务元数据明确拒绝并保留源，不静默取第一页或降级。D07整体尚未通过。

### D07 独立迁移分工调整

B1/B2底座开发已交当前8项目标与真实Web4项证据；能力仍只公开已验泳道，不将动态能力测试冒称五型已完成。PM暂不重复当前底座探针，待A模板/配置稳定后集中独立复验。

为复用两个代理并减少等待，原B继续独占非泳道 `migration/legacy-generic.ts`、`drawio-generic-migration.test.ts`及专用probe/report；A保留migration的index/types/legacy-swimlane及新模板、projector、configure。双方直接确认受控role/层/派生父子边契约。迁移使用旧scene及原字段metrics，不调用会重排/增高旧节点的默认writer；默认脑图曲线不能整型blocked冒称适配完成，表示有差异时先给具体证据由PM裁决。没有增加或销毁代理。

### D07-M 专项验收与模板视觉复核

PM 独立 `node --import tsx --test tests/drawio-generic-migration.test.ts` **12/12**；独立真实原生 probe **8/8**，固定本地 Chromium，公开 save→严格投影/渲染签名→PNG/SVG，全部绝对节点框与源内容/时间不变，脑图 C 控制点扣除裁切平移后逐值一致，renderer 正常关闭，无 Runtime/SQLite。独立证据 `output/playwright/project-manager-d07/{migration-tests.log,migration.log,migration/report.json}`；实际查看四型 manual PNG，字段可见。**D07-M 指定迁移范围通过**，默认能力启用和 B1/B2 联调仍待 A 冻结。标签覆盖次序、未知或旧未显示字段等按报告明确 blocked，未静默移位/丢字。

新模板方面，架构图最初 1410×4975 狭长和后续 1734×3268 大空白两次退回；当前 2058×2227 的分层网格/右治理经 PM 实际查看，通过该视觉专项。流程条件标签已缩到实际文字宽并以原生独立子元素表现，PM 看图复核位置改善。证据 `output/playwright/project-manager-d07-visual/` 与开发 `drawio-generic/`。这不是 D07 整体或全部画布手势验收，不再对已足够的两张继续可选打磨。

原 B 在等待 A 接口冻结期间，仅获准独立 D08-P1 纯 metadata 视图模型与关键规则测试准备，不接默认 UI/路由/共享 types；分组互斥、搜索归属、稳定时间排序/当前定位/原位编辑冻结顺序。没有新增或销毁代理。

### D08-P1 准备模型专项验收

PM 阅读纯模型和测试、独立定向 **7/7** 通过，证据 `project-manager-d07/workspace-model-tests.log`。分组互斥/时间排序/跨组搜索/前五展开/当前定位/原位编辑稳定/外部移组删除已覆盖；仅三新增文件，无 UI/store/路由接线。通过该准备范围，D08 状态仍待开始。

D09输入和关键预期预先冻结为 [质量评测计划](validation/QUALITY_EVALUATION_PLAN.md)：五类各3个正例，另列历史PBS负例；尚未执行、无虚构评分。脑图当前首次ELK乱序与server级联删除导致live状态不一致的设计问题已退回原A；A改用原生selectDescendants/delete和确认入口，B负责薄UI，不能服务器暗删或重新load。

### D07 脑图分支真实专项退回

PM独立运行 `drawio-mindmap-ui.mjs`，原有3步断言通过，但实际查看 `project-manager-d07/mindmap-ui/deleted.png` 发现已删分支的跨业务边及标签仍以悬空线留在native；仅normalize把它从已保存XML剔除。因此**专项退回**，不能把3步绿标为验收通过。固定供应公开 `delete` 默认断开连接，`deleteAll` 才包括关联边；已要求原A窄改selectDescendants→deleteAll，并对未normalize的原始XML检查关联线/标签无残件，再验证撤销及连续编辑。普通原生Delete存在相同live/保存差异风险，一并明确最小一致处理，不允许全图reload或服务器暗删掩盖。

### 脑图分支窄修复验通过

原A改为原生 `deleteAll`，增加未经normalize的原始XML严格投影、已删a/aa/cross绑定及标签无残件断言。PM同入口独立复跑3步通过，实际看 `project-manager-d07/mindmap-ui-fixed/deleted.png` 只剩根/保留分支及父子线；CtrlZ恢复全部业务与同级顺序，再编辑保存通过。**分支删除指定范围通过**，Web确认入口/普通Delete的错误草稿恢复/父子重连仍按对应专项验收。普通Delete最小一致规则已确定并写技术文档，待开发真实验证；不劫持原生快捷键，不重建画布。

### 普通原生删除一致性专项通过

固定Actions函数可接Alt事件不代表固定键盘真的绑定Alt+Delete；开发实际发现该组合无动作，固定KeyHandler及真实控键证实应为 **Ctrl+Delete**。PM独立 `drawio-native-delete.mjs` **3/3**：普通Delete残留业务线时明确`NATIVE_DELETE_INCOMPLETE`、原base不变；真实Undo→Ctrl+Delete后原始XML严格投影确认节点及关联边一起删除；继续编辑文字保存成功。实际查看ctrl-delete PNG无悬空残件，证据 `project-manager-d07/native-delete/{report.json,ctrl-delete.png,*.drawio}`，技术说明已改正确快捷键。不以此前Alt推断作为已验证使用规则。

### D07 并行迁移闭合调整

原A检查点明确旧泳道迁移尚未动。为减少串行等待，原B完成15份D09候选后接D07-M2，仅独占旧泳道转换器和专用验证；A继续新模板/horizontal patch/incident/configure/canvas，保留migration index/types。两人直接确认horizontal交叉容器/role；迁移沿旧scene一次物化，不调用新compile/ELK。旧未显示字段/不适用业务kind/跨容器组合等真边界明确报告，不能将“等待D07”原样冒充完整完成。

15例输入自查发现合成S02未指定审核责任人，PM作为该评测材料作者明确补充独立审核人员；候选manifest保留补充记录，不凭此更改历史PBS或猜测真实业务。

## 最终集成测试

### 2026-10-17 用户退回后的最小修复批次

用户指出独立NativeStudio外壳损害原UI/交互且创建/导出不能正常使用，正式退回当前预览交付。沿用原两代理：A暂停横向/配置/映射/迁移扩展，只修五类创建/保存与真实制品；B停止评测/M2扩展，复用旧Studio工作区组件/CSS/交互接native client/session/Host，不再另画工作台。15分钟检查点、约30分钟交可审链路；PM只独立核对实际UI创建→编辑→下载及原UI保留，不跑无关大矩阵。正常态不得堆恢复按钮，不开假能力，不提交推送/改版本。此前仅技术基线专项通过不等于产品体验通过。

2026-10-17 用户要求审查超过6小时的开发耗时并先启动。**继续开发已暂停，两位原代理保留并处于interrupted状态。** 已完成[流程复盘](validation/DEVELOPMENT_PROCESS_REVIEW_20261017.md)，明确范围膨胀、预览延后、串行接口等待及重复验证问题。当前代码前端构建并以独立样本数据启动在 `http://127.0.0.1:5189/#/native?diagram=baseline-architecture`；实际页面/原生iframe加载并显示已保存。五类样本可查看，能力矩阵仍只开放已验泳道新建；不宣称D07或最终集成通过。未修改生产数据、未提交推送、未更新版本。

尚未开始。D01–D09 各任务及 G1 分别通过后，由项目经理执行 G2 全链路集成测试。不能以单项单元测试或文档检查替代。既有实际手势证据覆盖节点/复制/归属/新连接；最终矩阵还须明确加入原生线段垂直拖动、边标签独立移动、浮动文字及锁定/撤销的真实操作，不能仅以引擎 XML 单测宣称全部画布交互通过。

### 2026-10-17 原UI纠偏指定链路验收

前述暂停记录为用户要求耗时审计时的历史状态；本次在最新纠偏授权下复用同一对代理完成窄修。原侧栏/文件行/CSS、新建五型、直接导出及内容属性已接同一原生会话。A五型真实编辑与生成通过；PM实际网页五型创建、流程图手动改字→自动保存→应用属性改字/改类型/新增节点→SVG下载→刷新复开通过，PNG也实际下载。Host/session35/35及完整构建通过。实页发现的深链未同步、旧图静默不响应、iframe跨realm判断错误均已退回原代理修复并复验。详见[验收记录](validation/native-ui-baseline-adapter.md)。

本批通过范围不扩展为D07/D08/G2整体通过。显式属性应用重设旧Undo起点及可能失选仍是明确限制；旧数据未切换，0.6.0不变，未提交/推送。两代理本批回报完成、保留待复用，额外路线任务继续暂停。

### 历史：切图启动页隐藏（随后被用户退回）

用户要求切图不要显示draw.io英文启动页。复用原B，仅修改DrawioHost.vue的显示生命周期与局部背景；原A只读核对固定供应，确认英文来自初始HTML而非lang配置。未改vendor、数据层或会话隔离，未引入额外白板缓存。加载期间iframe visibility:hidden/inert/aria-hidden；真实load加双RAF后显示；失败可重载，重试清src以避免configure消息竞态。

B的vue-tsc通过，PM一次Vite bundle通过。PM在5189真实连续切换流程→架构→思维导图→流程，捕获实际加载状态hidden=true/inert=true/visibility=hidden，完成后false/false/visible；过渡截图无英文，节点双击及属性读取正常，状态已保存。证据`output/playwright/review-session/switch-pending.png`及`switch-ready.png`。启动失败重试经过源码审查，未在用户正在使用的预览上人为制造资源故障。没有改生产数据、未重启Runtime、未提交推送或改版本。

### 历史：切图保留当前画面（随后被用户退回）

用户再次指出突黑/空屏不可接受。复用原A新增DrawioViewport、B调整切换顺序，保留旧标题/选中/画布直至独立候选真实ready，再同一渲染切换；不再先leaveCurrent清空视图。候选最多一个且不共享controller/source；完成卸旧。类型检查一次、PM一次bundle及5189连续切图/切换后实际改字保存和撤销通过。准备中抓到frames=2且旧前景可见、原标题仍在，结束frames=1、已保存。见[具体证据与限制](validation/native-viewport.md)。这是过渡方式验收，不是消除初始化耗时或完整路线完成。

### 2026-10-17 即时切图与稳定加载层：指定验收通过

用户明确退回“等加载完才切tab”，允许小型加载动画。复用同一对代理：A只改常驻画布加载层/空会话支持；B分离显示目标和真实会话，实现即时选中、标题、类型与URL，以及单个最新待打开目标、generation取消、稳定工具栏/属性栏。审查实际首帧风险后，B在保存/原生准备前增加nextTick+双RAF，A用纯CSS延迟140ms显示16px转圈。没有扩展后续路线。

B定向vue-tsc通过；PM两次定向Vite bundle通过（第二次包含首帧修复）。PM在同一5189隔离预览核对首次进入、PBS→脑图→PBS、连续数据流→流程→架构：每次点击的选中/标题立即更新且加载层不透明；最后一次目标正确、已保存、iframe回落为1。实际捕获小转圈截图；无属性栏时画布909.19×543.66，属性栏展开后641.19×543.66，各自切换前中后尺寸一致，标题与工具栏位置不变。证据及边界见[切图记录](validation/native-viewport.md)。此次不重新运行无关全套探针，不声称D07/D08/G2完成。生产数据库、Runtime数据根、0.6.0版本不变，无提交/推送。

### 2026-10-18 原版功能补齐：指定范围已验收

01:25（上海时间）用户对比后要求分组、自动排版、规整连线、隐藏内部节点悬浮信息和横竖切换。复用原A负责已有渲染配置/五型显式重排及方向；原B负责既有工作台入口、原生组合/取消组合与tooltip。先冻结既有configure接口，约20分钟检查点，任务不扩展到迁移/导入/评测。PM集中验收组合保存/复开、重排不变内容、两种方向、连线及真实hover，并保留即时切图/loading规则。仅独立副本做验证，未提交推送/改版本。

约01:43完成指定验收并更新同根5189预览。A修复写死方向、阶段回切膨胀与父端口一对多路由，8/8定向、server tsc及6次固定引擎往返+1次fresh脑图通过。B接原UI按钮/方向选择、精确group/ungroup桥、归属选择与tooltips=0，Host15/15和vue-tsc通过。PM审查退回选择框取消值未回滚，另将阻塞IAB的原生confirm改为应用内确认，共2次必要前端bundle。

PM在5191独立副本完成文件夹创建/移图只出现1次、组合r2→刷新→取消组合r3、脑图H→V、流程自动排版及实际SVG下载。5个原样本的内容/hash/createdAt全不变；实页抽取32条SVG线路无斜段，节点停留无内部字段且连接控点保留。早期旧确认页迟到提交导致另一QA页CAS冲突，已定位并保留记录；最后用最新会话完成，不当作产品覆盖写入或忽略失败。详情见[验收报告](validation/native-editing-parity.md)。本次保留原代理，未改生产库、未提交/推送/改0.6.0，不代表D07/D08/G2整体完成。

### 2026-10-18 Windows导出静默启动：指定范围已验收

01:46用户反馈导出弹出resources路径的黑色命令行窗口。原A只修renderer浏览器启动链，原B只读独立核查；保留固定供应、输出及协议，不改vendor/全局spawn，不扩展其他导出功能；不在用户数据库跑测试。

约01:55完成指定验收。实际Playwright启动选项缺少windowsHide，而固定headless-shell为CUI程序；改为Windows自有隐藏spawn和公开私有CDP管道，异常清理也隐藏且有界。B复审通过，并修复旧断连清新缓存及关闭中漏新启动的生命周期竞态。A定向8/8、服务端类型检查及小图PNG/SVG、所属PID退出/profile清理通过；首轮小图60秒偶发超时如实保留，未放宽预算，未当作消除所有超时。

PM独立5191副本通过真实导出队列验证：PNG833×1535/106630B，SVG21938189B，下载字节与SHA均一致；导出前后document和revision未变，QA正常关闭，PNG已打开核对。PM另跑服务端tsc通过。5189无进行中任务后以原数据根安全重启，PID31880健康并持续运行；未重建前端。证据见[静默导出核验](validation/native-silent-export.md)。不以主窗口句柄或旧标题扫描冒充所有窗口可见性证明。保留两位代理、数据和0.6.0版本，无提交/推送。

### 2026-10-18 分组入口与双色主题：指定范围已验收

约02:00用户要求看得到分组、统一方向控件、draw.io配色与年轻化的深浅主题。原A仅处理嵌入编辑器UI外观，原B处理工作台/侧栏/分组入口/方向分段控件及本机主题偏好；冻结appearance light/dark prop，由同一工作台传入，切主题不重载iframe/XML、不修改业务/渲染数据。PM负责实际页面集成、分组闭环与主题/保存/导出定向验收。仍保留既有UI结构，测试仅在5191独立副本，不提交推送改版本。

约02:13指定范围通过。原代理完成两套主题、太阳/月亮切换、列表头新建分组、画布分组菜单及方向分段按钮；集中vue-tsc一次通过。PM实际审查退回深色底栏单色图标，另定点修复子菜单箭头和旧按钮颜色动画造成的瞬时对比不足；总4次小型Vite bundle均通过，未重复全套探针。

5191实页验证新建“主题验收”分组后自动展开，移入脑图仅出现于组内，根列表重复数0；分组/取消分组菜单可到达。深浅切换及刷新保持偏好、上下层主题一致，主题/刷新/方向取消前后流程图revision4和完整document SHA、createdAt/updatedAt全部不变。确认横向后r5与orientation=horizontal，实际PNG下载84348B。深色属性面板及draw.io原生菜单文字可读；图纸保留原色。无分页图纸保白，真实分页时外围可随主题，未改图形和导出颜色。

原5189页面确认已保存后重载新构建，保持g1-pbs-source当前图形与数据，右上开关已可用；当前展示深色。最后页面确认button transition仅box-shadow/border-color，消除主题文字/底色不同步；5189服务无需重启。5191临时页关闭、实例正常停止。证据`output/playwright/appearance-20261018/`（light/dark截图、qa-dom、实际PNG）、`editing-parity-20261018/appearance-before.json`/`appearance-after-theme.json`/`appearance-after-layout.json`。具体边界见[工作台外观](validation/native-appearance-ui.md)、[嵌入外观](validation/native-appearance-engine.md)。无提交/推送/版本更新，D07/D08/G2状态不因此整体改变。

### 2026-10-18 深色画布背景：指定范围已验收

用户明确要求当前白色网格工作背景变黑，覆盖前批无分页工作区保白的限制。原A仅改外观CSS，原B只读复审，PM实际页面核对；目标为深色环境底和低对比网格，保留图元/原生网格位置密度与启停、浅色恢复及导出原色，不重载XML或改用户图形数据。

A用dark限定容器/无分页直属SVG背景#171717和background-blend-mode:soft-light，保留原网格image/position/size；B只读复审通过。一轮Vite构建通过，PM在当前已保存5189图形重载后实测dark背景rgb(23,23,23)/soft-light、light恢复rgb(255,255,255)/normal，原生网格图像和位置完全相同；最终保留dark。没有SVG图元fill/filter或模型写入，未为此低影响CSS重复执行导出大探针。证据`output/playwright/appearance-20261018/dark-background.png`及`background-check.json`。图形内原有白色泳道填充保留，未把图形本身反色。未提交推送改版本。

### 2026-10-18 去除底栏GitHub跳转：指定范围已验收

原A仅在应用自有appearance.ts精确隐藏底栏jgraph/drawio快捷链接（display:none，明暗均生效），缩放框以margin-left:auto保持居右，页签/+不变；PM复审并一次Vite构建通过。旧标签页刷新仍停留旧构建，直接导航返回ERR_ABORTED，未继续反复刷新；通过同一浏览器新开5189同图页面加载新index构建，原页保留未强关。实页GitHub可访问link计数0、对应元素display:none，缩放右对齐且实际自定义恢复39%成功。截图`output/playwright/appearance-20261018/footer-updated.jpg`。不改vendor/许可文件、其他GitHub链接、图形内容及导出，不增加低影响样式单元测试，不提交推送改版本；原代理继续保留。

### 2026-10-18 用户授权v1.0发布：版本冻结及验证通过

用户明确要求“提交推送作为v1.0”，本次据此解除此前禁止提交/推送/改版本的限制；应用与lockfile版本为1.0.0，拟推送main和annotated v1.0.0标签。原B更新README/CHANGELOG/Codex配置，明确当前原生开关、隔离数据根、资源安装、入口和未交付边界；原A只读审计供应/敏感文件并修正三处过时测试，PM复审。保留两个固定代理，不把发布当作D07/D08/G2整体完成。

发布候选排除整个output、数据库、运行浏览器/vendor/cache、生成配置和tsbuildinfo，纳入固定字体及许可/来源、draw.io许可/校验清单和脱敏夹具。历史Python配置存在硬编码AI密钥，已改环境变量读取；历史提交仍含原值，已提醒用户轮换，未擅自重写历史。候选明显密钥/私钥扫描通过。

首次全扫误纳入两份独立历史harness（指向已不存在server或旧别名），另发现三处断言/夹具过时：故意坏XML被二次严格解析、已支持horizontal仍视作非法、完整视觉配置尚未开放。仅修相应测试，保留生产校验；正式npm test更新为全部37份node:test文件，最终309/309通过、0skip。完整npm run build通过；固定资源核对3446文件、中文字体SHA和Chromium151通过。新临时工作区真实默认SDK：18工具发现→三节点创建r1→后台PNG及五制品交付→最新内容读取通过（PNG753×525、37671B），所属Runtime优雅退出及临时根清理通过。证据保存在忽略的output/release-v1-*。

5189无排队/运行导出后以原根正常重启为1.0.0（PID25380），未迁移或删除用户数据。发布提交与标签的远端结果以Git记录为准；本条不伪造推送证明。
