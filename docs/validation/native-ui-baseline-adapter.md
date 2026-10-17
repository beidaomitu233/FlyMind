# 原产品 UI 适配（指定链路已验收）

本批停止 D09/额外映射扩展。原 Studio.vue 保持为产品基线，NativeStudio 复用 WorkspaceSidebar、WorkspaceFileRow、studio.css：侧栏搜索/时间排序/分组/回收站交互、新建五类型对话框与示例开关、标题及保存状态、导出格式菜单。画布仅替换为 DrawioHost，存取仍为有工作区身份绑定的 NativeClient/NativeSaveSession。

格式菜单点击后提交活动文字、确认保存、创建不可变导出任务并轮询；成功自动下载所选格式，不要求手动生成五制品/刷新。失败显示恢复动作，正常状态不常驻重试/恢复下载/载入远端按钮。未接通的工作区备份入口本批不展示。

顶部撤销/重做/适合画布使用 Host 公开桥；内容属性按需读取原生选区业务 ID，复用原节点字段（文案、类型、角色/阶段/分层/父主题、条目、标记、说明），提交 capture+flush → manual content-patch → public mergeXML → 同会话 adoptCommitted，不因保存响应重载 Host。请求结果不确定保留同 key/payload，切图前阻止未确认属性提交。现有业务图不借用 canvas-only 映射表。

实际检查：`npx vue-tsc -b` 通过；`node --import tsx --test --test-name-pattern="explicit content result" tests/native-session.test.ts` 1 项通过（其他20项按名称跳过），验证属性结果采纳后编辑保存基于新修订、dirty 时拒绝采纳。未跑完整构建或大探针，5189 原独立样本 Runtime 未由本代理重启；真实创建/编辑/保存/格式下载与 merge/Undo 由 PM 在 A 桥/能力冻结后统一 bundle 检查。本记录不代表 D07/D08 整体验收。

界限：未接全量渲染配置、完整结构增删排序工具和原生选区实时推送；本批不摆不可用按钮。原生工具与右属性简洁模式由 A 按固定供应公开参数收敛，B 不改 iframe 内部 DOM 或引擎。

PM预览退回窄修：activate通过router.replace同步当前diagram查询参数，新建/切图可刷新深链；成功删除当前图清除查询参数。v2文件行显示‘只读·未迁移’，点击明确提示且不自动迁移。undo/redo/fit统一捕获同步或Promise错误显示fail。仅运行一次npx vue-tsc -b通过，未重启5189或运行大测。

## 项目经理实际验收：2026-10-17

通过范围限本次纠偏链路：

- 复用原WorkspaceSidebar、WorkspaceFileRow和Studio CSS；固定draw.io简洁模式无第二套固定菜单/左侧栏，业务形状库按需打开。
- 真实网页新建五类空白图，均进入对应原生文档并显示已保存。
- 流程图实际鼠标双击节点，键盘改为“提出需求”并自动保存；FlyMind属性面板读取选中业务节点，改为“需求评审”、类型start→task、新增“新节点”，画布同步且没有普通保存重载。刷新深链仍打开同一图，两节点及类型保留。
- 直接格式菜单实际下载PNG与最新r6的SVG到系统Downloads。SVG包含“需求评审”“新节点”，不含上一修订“确认需求”，证明导出当前保存结果。下载文件创建/修改时间均为导出时，图形修改时间未因导出改变。
- `node --import tsx --test tests/drawio-host.test.ts tests/native-session.test.ts`：35/35，无跳过；`npm.cmd run build`通过。日志`output/playwright/review-session/focused-tests.log`。
- 同一预览SQLite根保留，仅将本任务Runtime从PID24156认证关闭后更新为PID36848，端口5189。未重新seed、未改生产库、未提交推送或修改0.6.0版本。

PM真实页面退回并修复了iframe跨realm的HTMLElement判断；修复后通过新页面重新读取已确认保存结果，再执行属性改字/改类型/新增节点/导出/刷新完整复验。不是仅以开发独立宿主探针宣布产品可用。

刷新后真实页面截图：`output/playwright/review-session/final-workspace.png`；保留用户可查看的5189浏览器预览。当前图形深链包含实际新图ID，刷新后两节点仍在，状态已保存。

显式属性提交最终不使用不进Undo的remote merge，而在同iframe公开load并恢复视口，重设旧Undo起点；选区不保证保留。普通自动保存/ack无load。400%和100%视口精确一致及新手动操作Undo由A实际验证，证据`output/playwright/drawio-rescue-commit/`、`drawio-rescue-min/`。该限制保留；完整工具映射/全量渲染配置/迁移/分组回收站全矩阵仍未完成本批整体验收。
