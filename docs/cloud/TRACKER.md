# 线上协作任务台账

日期：2026-10-19。负责人：主代理 PM；固定代理 `dev_application`、`dev_engine`，均沿用 gpt-6.1-sol / medium。未提交、未推送、未修改版本号。

| 任务 | 负责人 | 状态 | 当前产物/下一动作 |
|---|---|---|---|
| C00-A 正式后台审计 | dev_application | 已验收 | PM核对正式源、真实账号/租户边界及缺口，复制后版本事实一致 |
| C00-B 引擎/授权审计 | dev_engine | 已验收 | 固定资源/本地SDK/服务边界核对；同步仍需单独产品验收 |
| C00-C 完整路线和接口冻结 | PM | 已验收 | `PLAN.md`、`CONTRACT.md`；用户明确先交付可部署版，公网发布后续执行 |
| C00-D 管理系统源码副本 | dev_application | 已验收 | PM逐一核对1294份文件源/目标摘要均匹配；可运行性由C01另验 |
| C01-A Java应用会话/团队 | dev_application | 进行中 | 已实现核心并构建/H2测试，PM已退回菜单bootstrap和真实FilterChain/完整启动门槛 |
| C01-B 可信上下文与团队数据根 | PM | 部分已验收 | Node边界模块/真实临时SQLite及原兼容15/15、tsc通过；HTTP装配/Java实联仍待验 |
| C02 远程MCP与在线工作台 | 固定双代理 | 进行中 | HTTP/MCP核心和云端UI已有可审切片，标准OAuth按 OAUTH_CONTRACT.md 并行实现 |
| C02-A 云端原生HTTP核心 | dev_engine | 部分已验收 | PM独立cloud HTTP+workspace 9/9，含真实PNG；身份为契约stub，真实Java/公开部署未验 |
| C02-B 导出可靠性与错误边界 | dev_engine | 部分已验收 | 三项退回已修复，PM独立HTTP/workspaces13/13通过；含abort后提交、零请求进程恢复、错误脱敏 |
| C02-C 固定团队MCP工厂 | dev_engine | 部分已验收 | PM独立真实SDK+本机回归14/14，真实PNG/改图/资源与撤权；标准OAuth/public host尚待 |
| C02-UI 原工作台账号团队薄接入 | dev_application | 待验收 | 类型/6项服务测试/构建已自测；真实身份与多tab、只读画布尚待 |
| C02-O 标准OAuth授权与MCP host | 固定双代理 | 进行中 | Java持久授权事实 + Node标准SDK provider，冻结契约，独立于应用Cookie |
| C03-S 公开diffSync双端探针 | dev_engine | 实验已验收 | PM核对真实13场景证据；裸patch同字段/未ACK撤销不收敛，是实现约束而非产品通过 |
| C03-M 三方渲染状态合并 | PM | 进行中 | 新merge/public patch及云端专用save方法；临时SQLite6/6通过，真实浏览器patch待验 |
| C03 实时协同产品接入 | 固定双代理 | 待开始 | 不以CAS拒绝替代实时协同 |
| C04 本地授权/部署/集成 | 固定双代理+PM | 待开始 | 用户暂缓真实公网发布；本批仍需本地授权、部署制品、隔离部署/恢复/业务验收 |

## 本轮审计与耗时分类

- 上一目标轮只核对并解释本地启动，未改变线上目标所需状态；对该目标按无进展处理。本轮已重新读当前仓库并开始真实审计、文档与复制。
- `list_agents` 初次仅列主代理，但恢复原名提示已有代理；已用 followup 复用两个原代理，未新增第三名开发代理。
- 发现后台根目录包含大量 worktrees/Reference；随后所有审计限定正式前后端路径，避免全目录重复扫描。复制以Git已跟踪的源码/构建闭包为清单，源只读。
- 当前 Docker daemon 不存在；不把它当成整个开发阻塞，不连接或重置源系统已有数据库。后续联调准备独立数据库环境。

各任务完成需补充实际命令、结果、证据路径和 PM 通过/退回结论。只写入计划不等于产品实现。

首批 PM 独立证据见 [initial-foundation.md](validation/initial-foundation.md)。Docker Desktop 启动请求已退出0，随后确认 Docker Desktop/com.docker.backend 进程实际存在，但 Linux engine pipe 尚未就绪；不能把启动 helper 成功当作数据库服务已运行，继续检查同一实例，不因观察超时反复重启。

用户已回复部署目标问题：尚未准备服务器，先交付可部署版本。公网发布按此明确暂缓；C04当前交付标准是实际制品/启动配置、隔离部署及完整业务验证和文档，不等待域名，也不削减账号/本地授权/团队/协同/远程MCP能力。

PM已独立执行 Java 的 FlymindIdentityTest/SecurityTest/BootstrapTest，Maven退出0，检查16/16报告；H2/JDBC事务和应用/管理双安全链通过，旧管理JWT验证器为隔离替身。随后追加密码重置/停用撤销由原代理定向复测，尚待PM核对新产物。该证据不替代全Spring/MySQL/Redis联调。

管理前端 frozen-lockfile 安装已完成，单个 @iconify/json 固定tarball遇两次ECONNRESET后沿原lock完整性校验公开镜像；未改版本/锁/源。类型与构建通过，PM逐文件复核最终214制品SHA256零差异，锁SHA256与源相同。管理端base=/admin/、API=/api，无继承统计脚本。

PM最新独立Java定向复核19/19（Identity10、Security8、Bootstrap1）通过，含Redis失败回滚与账号密码/停用撤销；仍为H2+Redis替身。OAuth新测试正在原代理实施，不包含在此通过数内。

Docker启动失败已经定位到sailor-ingest.sock访问/rename错误，随后ErrorReport出现Quit。未执行factory reset、删文件或反复重启。已异步告知用户并请求其方便时启动；继续完成代码，不将此误写为许可证或TOS问题。
