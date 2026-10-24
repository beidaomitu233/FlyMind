# U29 首用引导与简化 MCP 接入验收

## 2026-10-24 发布复核（覆盖下方早期未发布状态）

用户已明确授权本批通过 Actions 上线。U29 独立提交 `3bd9582`，首轮 CI 发现首用引导遮挡旧浏览器探针，最小兼容修复 `955c04b` 后，Verify 与候选运行 [39994902799](https://github.com/beidaomitu233/FlyMind/actions/runs/39994902799) 全部成功；Windows/Linux 包、实际 JAR/MySQL/Redis 验证及 production 均成功。生产发布于北京时间 2026-10-24 02:32 完成，`/readyz` 实测 ready=true、pendingWrites=0、releaseId=`run-39994902799-1`。

发布实页已看到首用四步引导、关闭后三卡首页、Codex/WorkBuddy 简短连接消息和高级说明折叠入口。只检查并关闭引导/连接面板，未修改线上图形或创建授权。截图：`output/u30-review/u29-live-home.png`、`u29-live-connect.png`；Actions 日志 `output/u29-production-final.log`。上传389,808,698字节耗时约2900秒，是本次部署主要耗时；不将它计为图形生成耗时。应用版本仍1.0.0，无新标签。

U30 技术/应用架构视觉、账号ID/新邀请/看板迁移等仍在本地，未混入该发布。

日期：2026-10-24。PM 复用原 dev_engine/dev_application（gpt-6.1-sol / medium），未创建替代代理。当前为**本地指定范围已验收，未提交、未推送、未部署**；新功能发布待用户明确授权。应用版本保持 1.0.0。

## 实际改动

- 未选图首页三个居中入口：创建第一个图形、安装到 Codex / WorkBuddy、团队协作；窄窗口自动纵排。
- 首次进入云空间弹出四步引导：任务分组与首图、Agent 连接、同图交替编辑、团队协作。逐步跳过、全部跳过、关闭与文档中重开；真实完成与跳过分开，进度按账号/团队隔离。
- 连接面板主消息缩为四句，复制后在 Agent 内继续，本人通过浏览器 OAuth 登录并选择团队。手动 CLI/JSON/旧包移入高级说明，不提供长期 PAT 或要求用户发送密码/Token。
- 当前云图的真实 teamId/diagramId 进入安装消息，标题不作为指令；本地图明确先显式导入。新增记录检查按实际人工与 MCP 提交修订判断，不以复制或打开页面冒充成功。
- 工作台浅色采用 Radix Iris + Slate：白色主区、灰白侧栏、清楚边框、Iris 主操作；深色保留原黑灰。样式变量不改变图形业务或节点配色。
- README、INSTALL_AND_USE、CODEX_SETUP、应用内文档改为云端简明入口；历史 Windows 包仍保留并明确范围。

## 审查与返工

1. PM 退回原千字技术安装消息，收为四句；实现规则保留于详细指南。
2. PM 退回交替编辑缺操作入口、全步骤无结束状态；已补去画布/同图 Agent 操作及完成/跳过统计。去除重复的底部关闭按钮，关闭仍可用右上角和 Esc。
3. 实页复现既有协同问题：人工属性 `mergeXML` 的显式 load 未携带 `diffSync`，vendor 将开关关闭，MCP patch 虽可见但 resetDiff 无确认并超时。最小修复仅在协同 load 保留 `diffSync:true`；未改供应、扩大超时或跳过确认。

## 实际执行与结果

- Node 20.19.6：`node --import tsx --test tests/drawio-host.test.ts tests/agent-connect.test.ts tests/onboarding.test.ts tests/flymind-documentation.test.ts`：**30/30**、无跳过；新测试已接入标准 test/test:cloud，另提供 test:onboarding。
- `vue-tsc --noEmit`、服务端 `tsc --noEmit`、Vite build、build-package：通过。协同窄修后再次集中前端类型/构建通过。
- CUA 实页：首次弹出；关闭与文档重开；首页三卡；新建任务组和可编辑图；安装消息复制并实际 Ctrl+V 粘贴；Codex/WorkBuddy 切换；当前云图身份；缺真实修改时不判交替完成；真实记录完成后进入团队；创建团队、取消团队弹窗、切换团队进度隔离；单步/全跳过与刷新不再弹；最终4步完成、0跳过；深浅色和484px窄窗口均实际查看。
- 隔离真实 SDK Streamable HTTP：读取 guide/当前图，人工标题提交后 MCP r3→r4 返回 PNG且保留标题；首轮发现上述超时。修复后重开同图、再次人工改标题到 r5、MCP r5→r6 返回 PNG；网页显示“协同复测已通过”，保留人工标题，无同步超时。没有新建替代图。
- 线上只读核对：`https://fly.hui7.fun/admin/` 和 MCP OAuth protected-resource metadata 均 HTTP 200。没有重置账户、修改线上图或新建授权。
- `git diff --check` 通过；其他任务的 `docs/README.md`、PRD模板、docs/images 原样保留，禁止混入发布。

隔离数据与截图保存在忽略目录 `output/onboarding-20261024/`：welcome-light.png、welcome-dark.png、welcome-narrow.png、same-diagram-after-fix.png、mcp-report.json、mcp-after-fix-report.json。预览监听 127.0.0.1:5206，独立 SQLite 与身份夹具，不是真实 Java/生产身份服务。

## 验收边界

- 这批没有改账号控制面/OAuth 协议、数据表、业务内容 schema 或导出引擎，不重跑已通过的整版 MySQL/Redis/五类出图验收。
- 未在用户真实 Codex/WorkBuddy 客户端中新装服务或新授予权限；“我已授权，继续”明确为用户自确认。实际新客户端 OAuth 安装仍需本人在客户端发起并确认；没有把隔离 MCP token 当生产授权。
- 发布只能走已配置的 GitHub Actions；当前生产自动部署已启用，未经本批推送授权不能推送。本机不 SSH，不改版本号、不打标签。

## 官方依据

- [Codex MCP](https://developers.openai.com/codex/mcp)：远程 URL、登录与客户端连接。
- [WorkBuddy MCP](https://www.codebuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide)、[WorkBuddy Connector](https://open.workbuddy.cn/docs/connector)：远程接入与 OAuth。
- [Radix 配色组合](https://www.radix-ui.com/colors/docs/palette-composition/composing-a-palette)：Iris / Slate 明暗配色层级。
