# v1.1.0 实施与验收台账

2026-10-20。开发分支 `codex/v1.1-development`。本文记录实现证据，不等同于发布公告。

## 最新验收（覆盖下方首批历史状态）

2026-10-23 最新线上状态：Actions `39933886793` 已将同一已验候选 `b930048` / `run-39926499342-1` 的 Java、application 和 admin 实际晋级。恢复后 PM 生产探针14项全部通过：后台login/info/router、独立前台登录/me/teams、安全Cookie、已有图真实PNG字节/SHA及修订时间不变、OAuth发现/匿名MCP拒绝、内部readiness保护和探针退出。线上浏览器五章节文档、Esc焦点返回、新建分组取消、管理后台进入用户管理及团队菜单也通过。独立Actions公网检查 `39982689930` success。证据及先前超时边界见[完整发布验收](../validation/actions-control-plane-20261023.md)。

`CLOUD_AUTO_PRODUCTION=true`、`CLOUD_CONTROL_PLANE_DEPLOY=true`、`CLOUD_ARTIFACT_HTTPS=false`已核对；开启时没有排队或执行中的main候选，未触发额外应用更新。后续授权main更新经完整CI后由受限Actions晋级，新增SQL迁移仍须审核服务器迁移清单；客户端固定 `/mcp` 地址不变。生产未改用户密码、未进行新的Codex OAuth授权/工具绘图；生产SVG/五制品、完整线上双端协作及全量v1.1发布验收不因此标成完成。应用仍1.0.0，未改版本、未打标签。以下为历史证据。

2026-10-21 首次公网状态：Linux `run-39450074276-1` 已受控晋级，真实登录、创建/打开图形及分组取消通过。保存输入回退、冷启预算正修复；PNG 验收时目标 HTTPS/SSH 连接超时，尚未完成线上验收。最新 `33610e5` 源码及两平台 CI 成功，production按开关跳过。自动更新开关暂为false，不能宣称 GitHub 自动部署已通过。以[首次线上记录](../validation/fly-first-online.md)覆盖本文下方较早的“尚未提供服务器/未推送/未部署”状态；不改版本、不打标签。

- `125101f` 已提交实时画布、批次导入与可信操作记录。原 UI、draw.io 和内容/渲染分层保留。
- PM 实页集中验证 **12 项通过**：双画布并发、本人撤销、旧撤销不能覆盖同字段远端修改、无同步整图重载、离线重基、真实 MCP 并发修改和 PNG、排空/同端口重启后画布与草稿恢复、全格式仅一图、实际目录选择/损坏项/丢回执精确重试、实际日志对话框、同字段冲突下载恢复/显式载入最新、远端删除不复活。证据 `output/playwright/v11-cloud-ui/report.json`。权威账号是隔离夹具，未外联。
- PM 编译版本机 Runtime 真浏览器 **3 项通过**：登录/团队授权进入原工作台、真实创建原生图形、退出后画布隐藏且业务 API 401。实页发现退出误用 GET，已修为 POST；证据 `output/playwright/local-auth-ui/report.json`。
- Java 完整 Spring/Tomcat **39/39、skip 0**，其中 6 个 HTTP 场景包含真实 Node 本地 gate、云身份与 OAuth 对 Java 的组合。读取 Surefire 报告复核；数据库为 H2，Redis/Redisson/限速为替身，不能视为 MySQL/Redis 已验。证据 `output/local-auth-control-plane-package.log`。真实联调发现 Jackson Long 时间戳字符串，现只对明确数字字段安全规范化，不放宽 ID/token。
- 独立 SDK 固定配置经历源应用两次停止/启动，revision、幂等回执、旧 PNG 摘要及工具 schema 保留，规则 guide 更新；网关自身重启后明确要求 initialize。此用例是同源码不同启动发布标识，未冒充不同生产二进制升级；实际晋级由目标 staging 验收。
- 维护单活/排空 **5 项**，部署验证 **5 项**通过；不同端口不能同时接管同数据根，已接受请求断 socket 后仍需落库/结算，超时不强杀或放行第二写者。旧任务保留 release/供应绑定，缺供应明确失败，不偷偷换引擎。
- 管理前端从正式 `integrations/xinghui-admin/frontend` 锁定依赖构建成功，214 文件、3,462,977 字节，base `/admin/`、API `/api`，无分析脚本。Java 新 jar 已包含本地设备授权迁移。
- 前后端类型检查、Vite、160 个预编译模块构建通过。完整旧回归初轮 **335/339**；4 项退回原代理：两项是旧标准固定38分断言（当前标准0分，23节点/26边及全部质量问题完整保留），两项是合法局部编辑的标签走线无槽。仅复测修复影响范围，结果在本节后续补录，不把初轮失败写成全绿。
- PM 最终 `npm run test:cloud` **99/99、skip 0**（84秒），日志 `output/v11-cloud-final.log`。原并行执行的三个真实出图测试因浏览器资源竞争超时；改为串行后 HTTP/OAuth/MCP 15/15，再集中99/99，未延长业务超时或放宽断言。
- PM 收尾修复影响范围 **79/79**（`output/v11-routing-final.log`），覆盖原4处失败、布局与项目/迁移。新连线采用实际文字宽度、旧标签只读避障、边界槽位采样和一次固定求解重试；保留原几何/近线/碰撞检查。普通泳道容器CRUD成功；原PBS拥挤的阶段重排仍明确 `ROUTING_LABEL_NO_SPACE` 并保持输入不变，需显式自动排版，不伪称所有局部重排都成功。
- 完整旧回归初轮335项通过加上述受影响复验，不冒称重新跑过修改后的全套。PM 在新路由代码上再次通过类型检查、Vite、预编译与独立包五类出图。
- 独立候选：`output/v11-deployable-win32/`，Windows x64 / Node20.19.6 / ABI115。固定供应校验，包内独立SQLite和固定浏览器完成五类PNG/SVG/drawio/JSON/project（5/5），9362文件的摘要/平台/ABI复核通过。npm干净生产安装遇 registry TLS ECONNRESET，改为在隔离包内复制本机已验证同平台依赖，再 `npm prune --omit=dev --offline --ignore-scripts`，不将此说成干净联网安装通过；正式CI仍用干净安装。证据 `output/v11-bundle-{supply,prune,smoke}.log` 与包内 `smoke-report.json`。
- 最新用户AGENTS替换后不再自动提交。此前 `82929b5` 保存账号授权、维护与部署流水线；后续路由修复、路由入口及本节等保持未提交。候选 `dirty:true`，已验证生产晋级默认拒绝，只有显式开发复核 `requireClean:false` 才校验通过。该包是审阅/隔离验证候选，不是正式发布或可晋级Linux包；应用版本仍1.0.0，目标1.1.0。
- Windows开发归档：`output/flymind-v1.1-development-win32-x64.tar.gz`，358,668,712字节，SHA256 `46547e2193996914228b12445e6f0680514ca5cbc81b4f087123dc3320aedc03`，同目录 `.sha256`；只打包已冻结候选，不含用户数据库/凭据/业务图。9362文件校验通过；制品包含app、admin、Java jar及ops模板。`82929b5` 是中间保存点，单独切到该SHA不能冒充完整1.1，仍需本轮未提交的入口/路由修复。

### 可部署代码与外部待验

已编写云平台候选构建、固定 SHA Actions、主分支自动 staging 开关和人工选择已通过 staging 的同一制品晋级流程。SSH 主机公钥固定；远端 root 所有的受限调度器先复制上传包到私有目录再验摘要，排空/停写/备份/切换/readyz，失败仅回退兼容代码，不覆盖新确认数据。自动晋级范围为 app+admin；Java/数据库/网关自身单独装配和审核，见 [安装与持续更新](V1_1_DEPLOY_AND_USE.md)。

尚未提供服务器，GitHub 工作流未推送运行。真实 MySQL/Redis、目标 Linux 的依赖/沙箱/字体、TLS/SSH、正式制品升级与失败回退、管理端真实 Redis 登录仍待目标环境完成。不是缺 SSH 就停止实现，也不将 Windows 证据当公网发布；目前不宣布正式 v1.1、不改版本号、不推送或打 tag。用户当前5189及数据均未操作。

## 首批历史记录

## 整合

- `0136937`：提交绘图质量标准、排版修正和统一 v1.1 需求/部署方案。
- `7d45bd0`：合入协同快照 `codex/cloud-collaboration-20261020`（`e5ad1e8`），保留原工作台和质量门槛。
- PM 合并基线：83/83 定向测试，前后端类型检查通过。日志 `output/playwright/v11-merge-tests.log`（输出不入 Git）。
- 未推送、未打标签、未修改应用版本号、未操作生产服务器。真实工作区及旧库未迁移。

## 当前批次

| 批次 | 负责人 / 范围 | 状态及证据 |
|---|---|---|
| V11-01 | PM：提交与分支整合 | 已通过合并基线；后续功能单独验收 |
| V11-02-A | dev_application：授权确认、身份变化保护 | 待最终验收；13 项客户端测试通过，真实 Java 授权仍待验证 |
| V11-03-B | dev_engine：SSE 房间、鉴权、协同提交、会话重基 | 待 PM 实页验收；会话 30 项与 HTTP 定向测试通过；单进程房间，以持久 SQLite 修订恢复 |
| V11-03-UI | PM：原工作台增量 patch/resetDiff、离线恢复 | 实施中；不整图重载同步，输入仅在本机捕获/应用边界短暂锁定 |
| V11-04-I | dev_application：导入事务、指纹、目录扫描；PM：UI/API | 待实页验收；全格式同源去重、并发幂等、失败不留空组已有定向证据 |
| V11-04-A | dev_application：可信 actor 与操作记录；PM：入口接线 | 实施中；成功事务留痕，不将保留的远端变更重复归因当前成员 |
| V11-05–07 | 远程 MCP 持久更新、可部署交付、整体验收 | 未验收；不得宣称 v1.1 已交付 |

PM 追加回归：75/75（云客户端、原/新会话、宿主协议、原/新导入），前端类型检查和 Vite 构建通过。这早于最终 UI/日志接线，不代替最终集成测试。

## 实页验证与剩余门槛

`scripts/cloud-ui-probe.mjs` 使用随机回环端口、临时团队数据库、两个独立浏览器和固定 draw.io，验证实际 CloudStudio 编辑、同步、本人撤销及断线重连。身份服务明确为夹具，不能作为 Java/MySQL/Redis 部署证据。结果在 `output/playwright/v11-cloud-ui/`，只有报告 `ok:true` 才判该切片通过。

首轮实页发现登录请求的原生 fetch 绑定错误（Node 单测未暴露），已修正，继续复验。不得将自测结果当成最终产品通过。

PM 实页复验已通过 6 项：真实双工作台编辑收敛、本人撤销保留对方修改、每端仅一次 load、断线未确认草稿自动恢复、project/content/drawio/png/svg 同批只新增一张可编辑图并归入目标组、可信双成员操作记录及实际记录对话框。`output/playwright/v11-cloud-ui/report.json` 为 `ok:true`，无外联，临时服务/浏览器已关闭。另独立 43/43（日志事务、协同 HTTP/合并、批次导入）通过；追加纸张变更来源冲突用例，批次 11/11 通过。

V11-03-B/03-UI 与 V11-04 当前切片通过以上限定验收；完整人工+AI并发、删改冲突交互、目录实物拖入、同一请求断回执后的批次重试仍属于最终集成门槛，不能据此宣布整期完成。

### 当前接口

- `GET /studio-api/native/activity`：可信工作区内按图形/分组/操作者/渠道/动作筛选，稳定 cursor 分页。
- `POST /studio-api/native/imports/items/preview`、`POST /studio-api/native/imports/items`：`batchId/itemId/requestId/source/target`，逐项原子提交及同源去重；服务端重算指纹，不信客户端“已通过”声明。
- 云端同路径位于 `/cloud-api/teams/:teamId` 下。actor 来自权威 principal，不能在请求体自报；MCP 使用其独立授权渠道。
- 导入组件直接逐源预检/提交，不新增大型上传 staging 平台；保留原始单源/请求预算。原设计中的专门预检 token 与 staging 会话不作为此切片已实现能力，实际由提交时完整重验、稳定分项回执和原子事务保证。
- 新建任意 draw.io/canvas-only 文件仍沿现有 capability 显式拒绝；同导出集已能确认的 draw.io 附属源仅参与去重，不偷偷开启未验收的画布导入。

仍须完成：真实控制面账号/邀请/撤权，人工+AI并发与同字段/删改冲突，目录投放/部分失败重试，记录入口，固定 MCP 升级与任务兼容，部署包/恢复演练。服务器未提供时先完成代码、配置、隔离验证；真实目标 OS、TLS、公网验收待 SSH 到位后执行。

## 代理与数据保护

### CLOUD-UX-01 云端空间与账号交互（2026-10-20）

用户退回顶栏空间/账号混排及菜单内嵌表单。PM参考[Notion空间与编辑器分区](https://www.notion.com/help/intro-to-workspaces)、[Figma成员邀请](https://help.figma.com/hc/en-us/articles/360039481034-Invite-members-to-a-team)，确定：侧栏空间切换、底部账号、创建/加入独立对话框、成员列表与邀请分区、低频成员操作收进菜单；画布顶栏只展示图形上下文及编辑操作，未选图不显示空标题输入。

复用dev_application实施CloudStudio/CSS；PM负责原NativeStudio/WorkspaceSidebar的两个可选slot与标题样式、差异审阅和实页验收。保留已有工作台、真实账号/API/权限、离开保存保护及原图形数据；不新增分享权限或改变内容/渲染层。

PM限定验收通过：类型检查与最终Vite构建成功，cloud-client身份/权限回归13/13通过；真实本机Java/MySQL/Redis账号下验证已有个人/pbs空间往返、图形列表隔离、取消创建后仍仅原两个空间、独立创建/加入弹窗、输入自动聚焦、Escape关闭并归还入口焦点、菜单互斥、底部账号菜单只含信息/退出、深色成员面板及768px/1280px排版。实际侧栏窄宽度还修正标题换行、压缩侧栏但不覆盖保存的桌面宽度偏好。创建/加入先prepareLeave再API，避免取消离开后已经产生团队操作。未在用户空间创建测试团队或发出邀请，未更改图形内容。

边界：当前团队响应没有personal/type字段，此片不按名称猜测空间类型；个人空间的成员入口仍可读取，邀请能力仍由控制面权威判断。此次通过的是该UI重构及上述定向链路，不代替完整成员增删/撤权矩阵。代码未提交、未推送、未改版本。

### 2026-10-20 本机真实基础设施启动

用户提供本机 `flymind` 数据库及专用账号后，PM只读确认原库为空，完成 MySQL 8.0.12 的8项Flyway迁移及首次管理员初始化。使用现有 Redis 的独立逻辑库5，未重置服务、未提升数据库账号权限，也未上传旧本地图形。入口为 `http://127.0.0.1:5194/#/cloud`，后台为同源 `/admin/`；仅绑定回环地址。

复用 dev_application 修复 Redisson 对空字符串密码仍发送AUTH的问题：只将空字符串归一为null，保留非空密码。PM审阅通过，定向测试1/1和完整打包通过，证据 `output/redisson-empty-password-build-final.log`。真实受限MySQL账号还暴露Druid将Flyway的可选performance_schema权限探测识别为失效连接；本机显式设置 `SPRING_FLYWAY_URL/USER/PASSWORD`，使用同一受限账号的独立迁移连接后通过，未开放performance_schema权限。

PM已用真实浏览器登录控制面账号、进入个人空间、新建示例流程图，看到“已保存 协同已连接”；从实际导出菜单完成PNG任务，生成92804字节文件，后台静态入口返回200、绘图readyz为ready。本机启动配置、日志和脚本保存在Git忽略且限制访问的 `output/local-v11/`，凭据不写入文档。该证据补齐本机MySQL/Redis初始化及单用户主入口，不替代目标Linux、多人权限矩阵、TLS或公网验收。未提交、推送、改版本。

复用 `/root/dev_application`、`/root/dev_engine`，gpt-6.1-sol / medium，不按任务重建。共享文件独占，代理自测后由 PM 审查、退回或验收。

Node 20 ABI 匹配 SQLite；测试使用 `C:/nvm4w/nodejs/node.exe` 和临时数据库。不重编用户依赖、不清理含真实工作区的 `output/playwright/review-session/`，不修复/重置 Docker Desktop。
