# v1.1 安装、使用与持续更新

2026-10-20，适用于 `codex/v1.1-development` 的交付候选。尚未发布正式 v1.1，也尚未部署公网。现有 1.0 下载包不会因这份文档自动升级。开发版应用元数据暂保留 1.0.0，发布前统一调整。

## 1 使用方式

### 线上团队工作台

部署完成后，打开管理员提供的 HTTPS 站点，以已开通的手机号和密码登录。进入团队后即可新建、编辑、分组、导入和导出图形；团队入口可管理成员和邀请，查看者不能修改图形。账号开通、停启用由管理端 `/admin/` 处理，不开放匿名自助注册。

同一张图可由多人同时编辑。不同字段的修改自动合并；同字段、删除与修改冲突时保留本机草稿，提供重试、载入最新及下载恢复数据。维护更新期间保留画布，恢复连接后继续同步。不要将冲突草稿误认为已经保存到服务器。

### 远程 MCP：客户只配置一次

管理员完成部署后向用户提供固定的 `https://实际域名/mcp`。在支持 Streamable HTTP 和 OAuth 的 MCP 客户端中添加这个地址，完成浏览器登录、团队选择及授权。示例仅表示通用 MCP 服务器配置，具体客户端的配置入口以其当前版本为准：

```json
{
  "mcpServers": {
    "flymind": {"url": "https://实际域名/mcp"}
  }
}
```

调用顺序：`get_drawing_guide` → 编写业务节点和关系 → `create_diagram` → 获取真实 PNG 和编辑链接。修改前调用 `get_diagram` 读取最新 revision，再用 `patch_diagram` 或 `update_diagram`。内容不写坐标、大小或走线；AI 提交需通过分图形内容标准。详细字段由在线工具 schema 和 guide 提供。

普通应用和绘图规则升级在云端完成，用户不重装本地 npm 包、不修改 URL。网关自身重启后，客户端需要重新初始化 MCP 会话；令牌撤销或授权过期时重新登录。固定链接不意味着永久免登录。

### 本机独立使用

本机安装仍可使用浏览器工作台，不必每次发起 AI 对话。已安装候选包后，首次设置受信控制面地址（实际地址由管理员提供），运行：

```powershell
$env:FLYMIND_CONTROL_PLANE_ORIGIN='https://实际域名'
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

先读 [部署初始化与回退边界](../../deploy/cloud/README.md)、[控制面部署说明](../cloud/CONTROL_PLANE_DELIVERY.md) 和 [维护协议](../cloud/MAINTENANCE_RUNTIME.md)。服务器 SSH 到位后先核对 OS/CPU、Node/ABI、Python、MySQL/Redis、端口、数据卷、TLS 和资源预算，再填模板。当前 Linux 模板不是已经验证过的服务器配置。

正式制品由 `.github/workflows/cloud-candidate.yml` 构建：锁定 Node 22.23.3、Java 17.0.19 和依赖，运行契约测试、Java HTTP 测试、管理端构建；分别在 Windows/Linux 安装生产依赖及固定引擎，并执行五类真实 PNG/SQLite 烟测，随后冻结清单和 SHA256。不能把 Windows node_modules 或浏览器复制到 Linux。

初始化分别配置 Java/MySQL/Redis、绘图应用、固定 MCP 网关、管理端静态资源和 Nginx/TLS。应用服务账号只写持久数据目录，密钥留在私有 env 文件。**自动晋级目前覆盖应用与 admin 静态文件；Java、数据库迁移及网关自身升级需独立审核、装配和验收。**

## 4 GitHub 后续更新

在 GitHub 创建 `staging`、`production` Environments，分别配置 Secrets：`SSH_HOST`、`SSH_USER`、`SSH_PORT`、`SSH_PRIVATE_KEY`、`SSH_KNOWN_HOSTS`。主机公钥须在首次可信核对后固定，流水线不使用即时 ssh-keyscan。生产环境设置人工审核人。服务器端只授权 root 所有的固定晋级调度器，不授予部署账号通用 root shell。

1. 首次主机验证通过后设置仓库变量 `CLOUD_AUTO_STAGING=true`。main 构建通过即上传同一 Linux 制品至 staging，并调用固定调度器。
2. staging 完成真实业务验收后，手动运行 `Promote verified cloud release`，填写原构建 `run_id` 和 `run_attempt`。
3. 流水线确认该 main 构建及 staging 均成功，下载原制品，校验 digest 后晋级生产，不重新编译。
4. 调度器拒绝新写、排空已接受操作、停止旧写者、备份持久目录、原子切换代码并核对目标 release 的 readyz。失败时按兼容级别回到旧代码，保留当前数据；不自动覆盖已确认写入。

未提供 SSH/Secrets 时仅构建，不会部署。修改 Java/网关/API 不兼容变更时，先完成其独立升级门槛，不能仅点击应用晋级。

## 5 当前验证边界

本次本地交付有 `output/v11-deployable-win32/` 和 `output/flymind-v1.1-development-win32-x64.tar.gz`，Windows x64、Node20.19.6/ABI115，包内五类出图与全文件摘要已验证。它是带未提交标记的开发候选，不能用于生产晋级，也不能当成Linux包。最新协作规则之后的改动尚未提交；需先审阅/授权提交，再从干净源码运行正式CI。安装说明在本文件，组件初始化见包内 `ops/README.md`、`control-plane/deploy/README.md`。

Windows 隔离环境已验证真实双浏览器与 MCP、PNG、目录导入与精确重试、授权和维护的定向链路，详见 [实施台账](V1_1_EXECUTION.md)。Java HTTP 使用完整 Spring/Tomcat，但数据库为 H2、Redis 为替身。真实 MySQL/Redis、目标 Linux sandbox/字体、TLS、SSH、GitHub 远端执行及生产恢复演练尚待目标环境验证；不能据此宣称公网 v1.1 已发布。
