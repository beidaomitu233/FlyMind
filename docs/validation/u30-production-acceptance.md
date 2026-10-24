# U30 生产发布与验收（2026-10-24）

## 实际发布结果

前台：<https://fly.hui7.fun/#/cloud>。后台：<https://fly.hui7.fun/admin/#/dashboard/overview>。

当前公网 `/readyz`：`ready=true`、`releaseId=run-40090921255-1`、`pendingWrites=0`。业务源提交为 `21e5fcda5d2748a439d86090d15c6838c4626d99`；不以仓库最新文档提交代替实际制品版本。

1. 原始 U30 候选 `40071395983` 已包含九项功能，但原全量生产传输三次失败，没有晋级。改为精简传输后，Actions [40089368684](https://github.com/beidaomitu233/FlyMind/actions/runs/40089368684) 实际发布成功：2,066,654字节、181秒传输，随后 Java 和应用均返回 `ok:true`。公网确认原 U30 新版本。
2. 上线实页发现后台默认概览404。新菜单授权和统计 API 已生效，但 Redis 跨 Java 重启保留旧 info/router 目录。仅为这两类缓存统一增加目录版本 `v20261024`，所有既有读取/写入/定向失效保持一致；不 flush Redis、不撤登录、不新增或改写 SQL。
3. 修复候选 [40090921255](https://github.com/beidaomitu233/FlyMind/actions/runs/40090921255) 的源码、Java 回归、真实 MySQL 8/Redis 7/JAR、Linux/Windows 平台全部成功。精简 Actions [40092008345](https://github.com/beidaomitu233/FlyMind/actions/runs/40092008345) 发布成功：1,669,712字节、94秒传输，Java 和应用分别返回 `ok:true`，公网再次确认最终目标。

原业务 manifest 与 JAR 字节保持制品原样；服务器还原后完整核对文件，既有 SQL 11项审核、备份及回退保留。用户在宝塔终端完成固定 SHA 静态工具安装并返回 `COMPACT_PUBLISHER_READY`；应用两次更新都由 Actions 执行。本机一次 SSH 停在本人验证，用户改为手动后已关闭，没有执行安装或应用部署。

## 九项需求及证据边界

| 需求 | 已交付 | 验证范围 |
|---|---|---|
| 技术架构图 | technical独立类型、图标与短技术名词、逻辑分组，完整24节点9分区参考样本 | 实际线上手动不分组创建；PM实际浏览器读取完整组/节点/连线文字，截图可见 |
| 自由编辑 | 原生节点/分区自由尺寸，普通改字保留几何，内容不要求坐标 | 线上分区宽346→474，服务端revision3及新页面重开精确一致；节点拖宽及服务端保存成功，节点精确重开专项未取得完整证据，未标通过；其余原生回归见U30集成 |
| 登录态新密码 | 前台只填新密码，6–72字节规则及原会话撤销 | 原浏览器/真实Java生命周期CI通过；没有修改线上用户真实密码 |
| 后台数据看板 | 首个顶级模块“数据看板”，默认“应用概览”，真实用户/空间/邀请/授权及趋势 | 最终线上真实登录、首模块/默认路由、7/30日HTTP200、UTC/trend长度和指标定义校验全部通过；PM截图确认 |
| 六位用户ID和团队 | 公共ID不替代内部主键，账号/查找邀请/收件箱接受与拒绝/成员管理贯通 | 线上auth/me实际六位字母数字通过；双账号邀请/接受/角色和目录由既有隔离实页及真实JAR/MySQL/Redis验证，不假称修改线上真实成员 |
| 手动分组可选，AI强制归任务组 | 手工只需图名/类型，Agent缺任务分组拒写 | 线上完整technical不分组创建通过；MCP强制及幂等归组CI通过 |
| 列表/组导入 | 列表与分组各自入口、显式目标、全格式去重 | 线上真实文件选择导入两份JSON，服务端目标分别为测试组和null，验证通过；目录/多格式去重由原完整CI覆盖 |
| 紧凑交互 | 行内F2/Enter/Esc、分组取消、悬停低频操作 | 线上F2/Esc取消未改变标题/revision；其他交互回归见U30集成 |
| MCP提示词 | 用户指定完整前缀、同地址复用、本人OAuth、先读guide、当前团队与图形身份 | 线上实际连接面板完整字面与当前teamId/diagramId一致，实际剪贴板逐字一致；没有冒充完成真实Codex/WorkBuddy新安装或代用户授权 |

## 证据位置

- `output/u30-compact-production.log`、`output/u30-cache-compact-production.log`：两次真实上传与 Java/应用回执。
- `output/u30-compact-ci-40086354876/`、`output/u30-cache-compact-proof/`：来源、精简包及Linux完整还原报告。
- `output/playwright/u30-production/account-report.json`：最终目标的账号/看板6项通过，`blocked=[]`、`pageErrors=0`；`admin-overview.png`、`front-login.png`。
- `output/playwright/u30-production/drawing-report.json`：首次U30线上9/10证据和未通过的节点重开专项；`group-reopened.png`、`mcp-install.png`；末次诊断另存，不覆盖成全绿。
- PM实际在用户已打开的同一验收图浏览器确认全部文字。可见iframe节点“管理后台 Vue”实际颜色`rgb(38,44,53)`、visibility=visible且有非零尺寸；早期无文字的headless截图原因未确定，未将推断当产品缺陷或视觉全通过。

线上检查仅新增以“U30验收”命名的图形、分组和导入副本供查看，未修改既有用户图、密码或成员关系。浏览器探针的自有会话和进程均已关闭。没有更新应用版本号或正式标签。

## 后续发布操作

固定的服务器工具已安装，后续通过 `compact-deploy.yml` 指定已验目标候选run、当前生产基线run和 `deploy=true` 执行；不再要求客户更新本地MCP配置或每次重装服务器工具。当前 `CLOUD_COMPACT_ENABLED=true`，旧全量 `CLOUD_AUTO_PRODUCTION=false`。

Push仅运行精简格式/权限/安全回归，避免把已经失效的首轮固定基线误用于每次push。真正的来源核对、两原始制品下载、精简、完整重放与上传只在显式dispatch运行，生产仍受main、生产环境、同一并发组及开关约束。当前不宣称“每次push自动上线”，也不把新功能、数据库目录迁移或静态root工具升级视为无审核发布。
