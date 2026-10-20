# 协作开发分支留存

2026-10-20，按用户要求将账号、团队、云端MCP与协同开发的当前成果保存到 `codex/cloud-collaboration-20261020`。这是在研快照，**不是已完成的协作发行版**。没有推送或调整应用版本。

FlyMind 起始稳定提交为 `4967e04`。此分支保留云端服务、原工作台薄适配、OAuth、协同合并核心、测试和实施记录。两个固定代理的最终交接见 `FROZEN_HANDOFF_APPLICATION.md`、`FROZEN_HANDOFF_ENGINE.md`；部分真实验证证据按原规则保存在被Git忽略的output目录。

后台在工作区原位 `../xinghui-admin/` 继续保留。为了本分支单独检出即可找回全部源码，另将其最终受控源码副本保存到 `integrations/xinghui-admin/`，逐文件校验清单为 `FROZEN_ADMIN_MANIFEST.json`。不含 node_modules、target、dist、运行数据库、日志、个人.env或密钥。该副本与源星辉项目分开，不触碰源项目。

恢复开发时先读 PLAN/CONTRACT/OAUTH_CONTRACT 及两份交接，再将 `integrations/xinghui-admin/` 放到新的受控开发位置并更新路径配置；不得覆盖已有工作区后台或连接原业务数据库。旧ADMIN_COPY_MANIFEST仍记录初始复制的来源事实，不代表冻结后的全部文件未变。

当前已验证范围包括身份/团队H2安全事务切片、云端临时SQLite隔离/实际原生PNG、SDK契约替身OAuth、双原生浏览器三方合并探针。尚未完成实际MySQL/Redis全栈联调、CloudUI身份收口、正式协同HTTP/工作台接入、本地账号授权、部署制品及最终集成。用户明确暂不处理本机Docker，暂缓这些基础设施实测；不能标记整体已验收。

后续绘图质量优化从上述稳定提交单独开展，不将这些在研云端改动混入。
