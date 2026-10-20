# v1.1 安装、使用与持续更新

2026-10-20，v1.1 正在首次部署至 `fly.hui7.fun`。GitHub 候选流水线按 main 的部署兼容修复重新构建；应用与 MCP 网关仍待 Linux 候选，**尚未完成公网应用上线及完整验收**。现有 1.0 下载包不会因这份文档自动升级，版本目标不等于已发布。

## 1 使用方式

### 线上团队工作台

固定线上入口为 [团队工作台](https://fly.hui7.fun/#/cloud)，管理端为 `/admin/`。应用部署并验收完成后，以已开通的手机号和密码登录。进入团队后即可新建、编辑、分组、导入和导出图形；团队入口可管理成员和邀请，查看者不能修改图形。账号开通、停启用由管理端处理，不开放匿名自助注册。当前 TLS 与控制面已准备，不代表上述工作台已就绪。

线上站点的根地址默认入口由服务器专用 Nginx 配置处理：仅对精确 `/` 的 HTML 响应，在空 hash 时设置 `/cloud`，已有团队、图形或 OAuth hash 原样保留；不修改不可变候选文件。不能用 `302 /#/cloud` 代替，因为 hash 不发送给服务器，可能造成循环。该配置已通过 `nginx -t`，完整浏览器行为仍随公网验收确认；文档与分享链接继续显式使用 `/#/cloud`。

同一张图可由多人同时编辑。不同字段的修改自动合并；同字段、删除与修改冲突时保留本机草稿，提供重试、载入最新及下载恢复数据。维护更新期间保留画布，恢复连接后继续同步。不要将冲突草稿误认为已经保存到服务器。

### 远程 MCP：客户只配置一次

固定 MCP 地址为 `https://fly.hui7.fun/mcp`。网关部署并验收完成后，在支持 Streamable HTTP 和 OAuth 的 MCP 客户端中添加这个地址，完成浏览器登录、团队选择及授权。当前网关仍待部署，不能将此固定目标地址视为已经可连接。示例仅表示通用 MCP 服务器配置，具体客户端的配置入口以其当前版本为准：

```json
{
  "mcpServers": {
    "flymind": {"url": "https://fly.hui7.fun/mcp"}
  }
}
```

调用顺序：`get_drawing_guide` → 编写业务节点和关系 → `create_diagram` → 获取真实 PNG 和编辑链接。修改前调用 `get_diagram` 读取最新 revision，再用 `patch_diagram` 或 `update_diagram`。内容不写坐标、大小或走线；AI 提交需通过分图形内容标准。详细字段由在线工具 schema 和 guide 提供。

普通应用和绘图规则升级在云端完成，用户不重装本地 npm 包、不修改 URL。网关自身重启后，客户端需要重新初始化 MCP 会话；令牌撤销或授权过期时重新登录。固定链接不意味着永久免登录。

### 本机独立使用

本机安装仍可使用浏览器工作台，不必每次发起 AI 对话。已安装候选包后，首次设置受信控制面地址（实际地址由管理员提供），运行：

```powershell
$env:FLYMIND_CONTROL_PLANE_ORIGIN='https://fly.hui7.fun'
flymind login
flymind studio
```

`login` 打开本机登录页，密码在该页面输入，不交给 AI。选择团队后授予本设备和本工作区授权。本机图形留在本机，不因此上传团队空间；本地与线上数据不自动合并。`flymind logout` 退出本机授权。可为 `flymind studio` 建立快捷方式；若用 bat，设置相同控制面地址后调用该命令即可。

v1.1 本机业务接口也逐次校验授权，缺少配置、断网或撤权时拒绝继续读取/修改业务数据，不把本地缓存当永久许可。升级不会自动重绑另一账号、团队或工作区。旧未授权 Runtime 不会被新版复用；应先正常关闭旧实例，再用新包启动，保留旧数据目录。

## 2 导入与导出

- 在侧栏菜单选择“导入图形”，或把文件/目录拖到分组或未分组列表。目录递归扫描，但不会自动创建多层文件夹；可在导入窗口选择目标或新建分组。
- 同一导出集的 project JSON、content JSON、drawio、PNG、SVG 只导入一份可恢复的图形，优先保留完整项目和人工排版。PNG/SVG 不做 OCR，不单独变成重复图。同源内容不一致时要求选一份。
- 合法人工草稿可以带内容建议导入，格式或引用损坏的文件会列出失败。任意独立 drawio/canvas 文件仍按 capability 限制明确拒绝，不假装支持。
- 请求结果不明确时点击“重试未完成项”，沿用原请求确认，不重复导入已成功项。
- 导出 PNG/SVG/JSON/project/drawio 使用固定快照；任务、制品和操作记录可追溯。导出时间独立于图形创建/修改时间。

## 3 运维首次部署

部署包包含 `application/`、`admin/`、`control-plane/`、`ops/` 和 `candidate.json`。Java 管理端源码位于仓库 `integrations/xinghui-admin/`，不依赖开发者电脑的上级副本。

先读 [部署初始化与回退边界](../../deploy/cloud/README.md)、[首次落地说明](../../deploy/cloud/FLY_FIRST_DEPLOYMENT.md)、[控制面部署说明](../cloud/CONTROL_PLANE_DELIVERY.md) 和 [维护协议](../cloud/MAINTENANCE_RUNTIME.md)。当前已完成 TLS 签发及续期启用，Java 控制面回环18080、独立 MySQL 与 Redis7 运行，管理员首次初始化已验证，私有 bootstrap 已删除。未在本文记录任何登录资料、密钥或服务器 IP。

应用与网关仍须完成目标 Linux 固定资源、Node/ABI、Chromium 动态库与 sandbox、字体、服务账号及持久目录权限核验。Python 安全解压按 `tarfile.data_filter` 能力检查，支持具备该能力的3.11.6，仍保留 `filter='data'` 与全部越界/预算检查；不能用“不够3.12”误判，也不能取消安全过滤。

正式制品由 `.github/workflows/cloud-candidate.yml` 构建：锁定 Node 22.23.3、Java 17.0.19 和依赖，运行契约测试、Java HTTP 测试、管理端构建；分别在 Windows/Linux 安装生产依赖及固定引擎，并执行五类真实 PNG/SQLite 烟测，随后冻结清单和 SHA256。不能把 Windows node_modules 或浏览器复制到 Linux。

初始化分别配置 Java/MySQL/Redis、绘图应用、固定 MCP 网关、管理端静态资源和 Nginx/TLS。应用服务账号只写持久数据目录，密钥留在私有 env 文件。**自动晋级目前覆盖应用与 admin 静态文件；Java、数据库迁移及网关自身升级需独立审核、装配和验收。**

## 4 GitHub 后续更新

当前选择**单环境线上测试、main 验证后自动更新**，不并行运行第二套 staging。`production` Environment 已配置 `SSH_HOST`、`SSH_USER`、`SSH_PORT`、`SSH_PRIVATE_KEY`、`SSH_KNOWN_HOSTS`，仓库 `CLOUD_AUTO_PRODUCTION=true`，自动 staging 关闭。主机公钥由可信会话固定，流水线不即时接受未知 hostkey。

实际更新操作：

1. 按授权审查并合入 main。PR 只做验证，不部署；main push 触发 `Build cloud candidate`。源码契约、Java与管理端构建、平台固定供应和真实导出烟测必须成功。
2. `production` job 依赖 platform 成功，从**同一次 run**下载已冻结 `flymind-linux-x64` 包及摘要，不在生产机重新编译。用 production Environment 的受限 SSH 账号，经 `flymind-upload` stdin 流上传并核 SHA，再调用 root 所有的固定调度器。账号 key 使用 forced command，不提供任意 shell、SFTP 或 SCP。
3. 调度器拒绝新写、排空已接受操作和当前导出、停止旧写者、离线备份持久目录、原子切换应用代码，并核对目标 release 的 readyz。失败时按兼容级别回到旧代码，保留当前数据；不自动还原旧数据库覆盖已确认写入。首次没有旧版本时失败停新应用等待修复。
4. 维护时客户端保留未确认草稿并收到 reconnect；完成后核对协同恢复、PNG/下载与同一 MCP 链接。正常后续更新无需人工 SSH。Environment 审核人是可选运维策略，不作为每次额外审批的产品前置。

`cloud-production` 并发锁串行晋级。不要同时开启 `CLOUD_AUTO_PRODUCTION` 与 `CLOUD_AUTO_STAGING`：两开关同为 true 时，staging 不运行，production 在 SSH 前检查失败。原双环境模式及 `Promote verified cloud release` 仍保留，但它要求同 run 的 staging 成功，不能用于本次单环境首次部署，也不会伪造一次 staging 通过记录。

**Java、MySQL/Redis 迁移及网关自身不随应用 current 软链自动升级。** 它们使用独立位置和服务，需单独审核、备份、排空及兼容验收；admin 静态文件随应用更新时仍需兼容现有 Java API。普通应用更新保留稳定网关及 `/mcp` 会话；网关自身升级会关闭旧内存会话，客户端需重新 initialize，必要时重新授权，URL 不变。发生不兼容 API/schema 变更时不能仅运行应用晋级。

## 5 当前验证边界

历史本地交付有 `output/v11-deployable-win32/` 和 `output/flymind-v1.1-development-win32-x64.tar.gz`，Windows x64、Node20.19.6/ABI115，包内五类出图与全文件摘要已验证。它是带未提交标记的开发候选，不能用于生产晋级，也不能当成Linux包。该历史证据保留，不替代当前 main 干净来源及正式 Linux CI 的验证。安装说明在本文件，组件初始化见包内 `ops/README.md`、`control-plane/deploy/README.md`。

Windows 隔离环境已验证真实双浏览器与 MCP、PNG、目录导入与精确重试、授权和维护的定向链路，详见 [实施台账](V1_1_EXECUTION.md)。原 Java HTTP 自动测试使用完整 Spring/Tomcat、H2及Redis替身；当前目标机已另完成真实独立 MySQL/Redis、控制面首次初始化与 TLS 准备。这些进度仍不等于整套公网绘图已验收。

**完整公网验收待 PM 填入**：Linux候选/实际 release及readyz、工作台登录和团队权限、双浏览器同图+AI及断线恢复、远程OAuth MCP和真实PNG/下载、自动晋级与回退/备份演练。当前候选流水线仍在执行、应用/网关尚待上线；在这些项目真实通过前，不宣称公网 v1.1 已完成发布。
