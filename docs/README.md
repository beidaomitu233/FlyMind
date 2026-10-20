# FlyMind 应用文档

2026-10-20 最新目标：[v1.1线上协同一期与持续更新](releases/V1_1_PLAN.md)，整合团队/空间/操作记录、完整同图实时协作、远程MCP持续更新、文件/目录导入去重和GitHub部署。用户已确认同图实时编辑包含在1.1；目前为目标版本与实施方案，尚未发布。

2026-10-20 新增[持久MCP更新方案](MCP_UPDATE_STRATEGY.md)与[ADR002](decisions/ADR-002-managed-remote-mcp.md)：客户首次配置固定HTTPS地址，以后由云端更新。源码审查与方案已完成，远程部署和升级机制仍待实施/验收；当前安装包及本机工作区行为不变。

2026-10-20 当前批次为[绘图质量修正](DRAWING_QUALITY_PLAN.md)：协作开发已留存在独立本地分支，强制内容标准1.1与本批排版修正已通过[限定范围集成验收](validation/drawing-quality-integration.md)。本机MCP已按用户授权切到已有draw.io工作区；旧聊天连接仍需Restart。质量改动未提交、应用仍1.0.0，没有将未验收协作能力合并到本批。

2026-10-19 新增账号、团队、实时协同及远程 MCP 的线上化目标，按[线上协作实施方案](cloud/PLAN.md)推进；保留原工作台，复制复用星辉管理后台。该方案扩展此前的单用户边界，不代表线上能力已实现。旧版安装与发布记录继续保留。

更新日期：2026-10-18。当前版本：1.0.0。确定路线：以 draw.io 替换自研画布，FlyMind 负责 AI 绘图内容、质量标准、渲染策略、MCP 和图形管理。

**2026-10-17 当前纠偏：保留原有工作台UI与交互，只替换底层引擎。** 独立NativeStudio技术试验壳已被用户退回；本批已复用原侧栏、标题、工具栏、属性和新建/导出交互，修复创建→编辑保存→导出。下述历史技术专项通过不代表当前产品整体体验交付已通过。

当前小批次已在独立预览完成原UI复用、五类网页新建、流程图画布与属性修改/保存/复开、PNG/SVG直接下载的指定验收；见[具体证据与限制](validation/native-ui-baseline-adapter.md)。完整工具映射、旧数据默认迁移及G2仍未验收，不宣称全路线完成。

2026-10-18 追加的分组、显式自动排版、横竖切换和隐藏内部悬停字段已完成指定验收并更新5189预览，见[工作台补齐核验](validation/native-editing-parity.md)。已有图不自动重排；原生组合/锁定元素不能安全全排时明确拒绝。其他渲染配置、旧数据迁移和后续阶段状态不因此变更。

Windows导出控制台弹窗已改为隐藏子进程启动并更新5189；真实PNG/SVG队列出口及进程清理通过，见[静默导出核验](validation/native-silent-export.md)。

工作台已提供浅色/Codex风格深色及右上切换，分组入口与横纵分段控件已通过实页验收并更新5189；见[外观与入口核验](validation/native-appearance-ui.md)。界面主题不改图纸/导出颜色或文档时间。

## 从这里开始

普通用户从[下载、安装与使用](INSTALL_AND_USE.md)开始；GitHub 分发及未来 npm/Registry 上架步骤见[发布维护](PUBLISHING.md)，实际独立安装证据见[安装包验收](validation/npm-distribution.md)。

| 文档 | 回答的问题 | 使用时机 |
|---|---|---|
| [产品需求 PRD](PRD.md) | 按 PBS 参考结构编排的 11 章需求，覆盖页面、字段、状态与数据流转 | 需求确认、交互设计、产品验收 |
| [技术设计](TECHNICAL_DESIGN.md) | 两层模型、draw.io 接入、双向同步、存储、MCP 和后台导出如何实现 | 开发、联调、技术验收 |
| [实施计划](IMPLEMENTATION_PLAN.md) | 从哪里继续、任务顺序、依赖、产物、验收及未决事项 | 每次开始或结束开发 |
| [开发验收台账](DEVELOPMENT_TRACKER.md) | 两个固定代理的任务、回报、验收/退回及最终集成测试 | 开发协作 |
| [draw.io 路线决策](decisions/ADR-001-drawio-engine.md) | 为什么采用该引擎、替换边界是什么 | 技术取舍、后续调整路线 |
| [绘图内容标准](DRAWING_STANDARD.md) | 五类图形怎样表达内容、怎样修改 | AI 绘图、质量评审 |
| [当前 AI 调用说明](AI_DRAWING_GUIDE.md) | 当前已实现版本怎样调用 | 使用现有 MCP |
| [当前 Codex 配置](CODEX_SETUP.md) | 当前版本怎样安装和连接 | 本机配置 |
| [历史路线](ROADMAP.md) | 之前实现过哪些内容、原来怎样规划 | 历史查询 |
| [文档检查记录](validation/DOCUMENTATION_BASELINE.md) | 文档和示例实际检查了什么 | 基线复核 |
| [PRD 重写检查](validation/PRD_PBS_FORMAT_REVIEW.md) | PBS 结构对应、需求保留及引用检查 | 本次 PRD 修订复核 |
| [draw.io 供应核验](validation/drawio-supply.md) | 固定版本、资源清单、原生协议及供应缺口 | D01 核验 |
| [数据与样本基线](validation/drawio-data-baseline.md) | 在线备份、独立恢复、脱敏夹具及存量问题 | D01 核验 |
| [原生泳道引擎核验](validation/drawio-engine.md) | 编译、投影、局部修改、真实编辑器往返及模板边界 | D02 核验 |
| [v3 项目模型核验](validation/drawio-project.md) | 两层结构、稳定摘要、XML 一致性与标准配置边界 | D02 核验 |
| [原生编辑核验](validation/drawio-editing.md) | 人工新增/复制/重连、局部结构修改及 JSON 清空命令 | D03-A1 核验 |
| [编辑器宿主核验](validation/drawio-host.md) | 公开消息、原生业务库、显式提交与会话隔离 | D03-A2 核验 |
| [原生存储核验](validation/drawio-native-storage.md) | 同库 v3、幂等、CAS、混合读取与隔离 API | D03-B1 核验 |
| [保存会话核验](validation/drawio-save-session.md) | 单请求队列、精确重试及隔离恢复草稿 | D03-B2a 核验 |
| [后台资源准备](validation/drawio-runtime-supply.md) | 固定 Chromium、中文字体与本项目资源的独立诊断 | D04 供应核验 |
| [原生后台渲染核验](validation/drawio-renderer.md) | 原生 PNG/SVG、固定字体、资源封装、预算及性能 | D04-A 核验 |
| [导出任务核验](validation/native-exports.md) | 不变快照、租约、五制品、无页面导出与工作台下载 | D04-B 核验 |
| [后台实例核验](validation/native-runtime-instance.md) | 按需启动、单实例、工作区认证及故障关闭 | D05-A 核验 |
| [原生 MCP 核验](validation/native-mcp.md) | 默认 SDK 图片交付、质量与幂等、同会话重启恢复 | D05-B 核验 |
| [G1 真实交替核验](validation/native-g1.md) | 两轮原生手势/AI结构修改、冲突、无页面导出及故障恢复 | G1 核验 |
| [G1 手势与路由核验](validation/native-g1-editing.md) | 实际控点、端点连接与固定原生路由的范围和证据 | G1-A/V 核验 |
| [旧泳道迁移核验](validation/native-migration.md) | 只读预览、源摘要、原几何/覆盖映射及阻断项 | D06-A 核验 |
| [备份与离线恢复核验](validation/native-backup-restore.md) | 一致备份、来源审计、身份旋转、中断回退及真实重新导出 | D06-B 核验 |
| [四类旧图迁移核验](validation/native-generic-migration.md) | 流程/架构/脑图/数据流原几何、字段及曲线保存与明确阻断项 | D07-M 核验 |
| [固定质量评测输入](validation/QUALITY_EVALUATION_PLAN.md) | 五类各3份材料、关键关系及修改要求，另列历史PBS负例 | D09 待执行 |
| [工作台核验](validation/native-studio.md) | 真实保存/IndexedDB恢复/切图、混合只读与换库拒绝 | D03-B2b 核验 |

## 文档状态

用户已确定采用 draw.io，并授权将当前成果作为1.0.0提交推送。PRD 和技术设计是目标基线，D01–D06 与 G1 已通过指定范围验收，D07 正在实施；发布版本号不改变未验收阶段状态，不自动切换默认引擎或迁移用户数据。新安装启动方式见仓库README。

2026-10-16 已开始项目经理与固定双代理开发流程，迁移前现有应用 80 项测试及构建通过；draw.io 新路线仍按阶段验证。每项新能力的实际状态，以实施计划、开发验收台账和证据为准。

文档优先关系：用户最新决定 → 路线决策与 PRD → 技术设计 → 实施计划。发现冲突时先记录问题、修订相关文档，再实施；不能在代码中悄悄改变产品规则。

当前调用说明描述现有实现。只有新接口真实可用并通过测试后，才更新其中的参数、MCP 工具说明和安装命令。内容标准继续有效，与引擎无关。

## 项目边界

- 当前产品和开发基线：`D:\AIBuilder\PM\flyMind`，Vue 工作台、FlyMind MCP、SQLite。
- 可复用的历史接入：上级 PM Runtime 的 draw.io 静态资源、iframe 通信及资料；先验证再迁入。
- 上级旧项目的 PRD、API 和任务卡保留为历史资料，不能据此恢复双宿主、桌面打包或材料平台等旧范围。
- `.local-data/pm.db` 与 `flyMind/data/flymind.sqlite` 属于不同历史应用，不能直接覆盖、合并或替换。

## 持续更新规则

1. 新需求写入 PRD，明确影响的需求编号、范围和验收条件。重大路线变化新增 ADR，保留原决定及被替代关系。
2. 接口、模型、存储和同步行为变化，同步更新技术设计与真实 schema；新增字段标明兼容和迁移方案。
3. 实施计划状态使用“待开始、进行中、待验收、退回修改、阻塞、已验收”。开发代理回报后，由项目经理独立验收并记录命令或人工步骤、结果和证据路径。没有证据不标已验收。
4. 每次开发结束补齐下一步、剩余问题和恢复上下文，不能只留聊天结论。截图、测试输出不代替需求和技术说明。
5. 绘图标准、机器检查、MCP guide、skill 与示例发生关联变化时一起更新，避免 AI 读取到旧规则。
6. 发布版本号与文档日期分开管理。用户未授权时不提交、不推送、不更新应用版本号。

当前工作为 [D07 五类图形完整适配](IMPLEMENTATION_PLAN.md#2-任务清单)，D01–D06 与 G1 已通过项目经理指定范围核验；当前不继续开发自研画布交互。代理分工和复用规则见 [AGENTS.md](../AGENTS.md)。
