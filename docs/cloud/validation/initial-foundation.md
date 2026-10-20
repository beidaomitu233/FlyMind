# C00/C01 首批基础核验

日期：2026-10-19。审查者：主代理 PM。只验收本页所列范围，不代表线上协作或完整 C01 已通过。

## 1. 正式源码复制

PM 独立读取 `ADMIN_COPY_MANIFEST.json`，对清单全部文件分别计算源与目标 SHA256：1294 文件、3232216 字节，源不匹配 0、目标不匹配 0。核验发生在副本后续开发前；后续有意修改不应改写原始复制摘要。

来源：UI HEAD `e313de8bd9c92924efdba64b99452917e72b24b0`，Java HEAD `ff68475be7aeaa941fe62c78aa66272f075178fb`。源根并非 Git 仓库，已按两份正式源码复制，没有复制历史 worktrees/Reference 或业务数据库。副本位置为工作区 `xinghui-admin/frontend`、`backend`。

通过范围：可追溯复制。排除配置、默认密钥文件、账号种子后，副本需补环境模板和显式初始化才能运行；完整构建/运行另行验收。

## 2. Node 可信上下文与团队数据隔离

新增 `server/cloud/identity.ts`、`team-workspaces.ts`，逐请求向固定控制面 introspect，验证用户/团队/角色/期限；无权限时在创建工作区目录前失败。团队根使用 teamId 的 SHA256，工作区缓存有容量限制，云端新库为空。幂等请求 ID 绑定团队及用户，避免成员之间碰撞或重放。

`DiagramStore.init({seedExamples:false})` 为新增可选项；原有无参数初始化保留原行为。

PM 实际执行：

```powershell
& 'C:\nvm4w\nodejs\node.exe' --import tsx --test tests/cloud-workspaces.test.ts tests/sqlite.test.ts tests/native-workspace.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.server.json
```

结果：15/15 定向测试通过，服务端 TypeScript 检查通过。覆盖控制面 HTTP 真实请求/撤权后再次验证、团队返回错配/过期/畸形响应、无权限不建目录、两团队同图形 ID、回收站/重启隔离、成员请求键隔离、缓存并发容量，以及原本地分组/排序/SQLite 事务和迁移回归。

身份上游测试使用独立 HTTP 权威响应夹具，工作区使用真实临时 SQLite；不能据此声称 Java 线上登录已联调。cloud HTTP 入口正在另一切片实现，当前这些模块尚未挂载成对外服务。

首次测试发现 PATH 为 Node24、portable 为 Node22，但本工作树 better-sqlite3 编译目标为 Node20 ABI115。没有重装依赖或改用户数据；使用现有 Node20.19.6 重新验证通过。含 SQLite 的后续验收沿用该路径。

## 3. 未通过的范围

### 后续已追加的局部验收

PM 随后独立执行 `cloud-http.test.ts` 与 `cloud-workspaces.test.ts`，9/9通过，包含独立控制面 HTTP 契约夹具、Cookie/Origin/Host、角色/团队/root/CAS/actor键、实际原生 PNG 导出和受保护下载、全局队列容量。该结果不包含下面列出的传输断开、无请求恢复与完整身份实联。

PM 也独立执行 Java 定向 Maven 命令（FlymindIdentityTest、FlymindSecurityTest、FlymindBootstrapTest），退出0；当时16/16报告与源码核对。新追加的密码重置、停用撤销及精确状态校验由原应用代理复测，最终合并产物还须核对。H2和实际Spring安全配置生效，旧管理JWT verifier是明确隔离替身，未验证真实Redis/JWT整机链。

- Java MySQL/Redis 全服务启动和 Node 真实联调仍未验收；开发自测/H2/MockMvc 不能替代该证据。
- 云 HTTP 的“传输关闭早于入库”“重启后无人访问仍恢复”“未知FS错误脱敏”三项已退回原引擎代理修复，未通过前不开放公网。
- 远程 HTTP MCP/OAuth、原工作台云端登录入口、实时 room/ACK 重基、本地授权和线上部署仍未交付。
- draw.io 同步探针有明确不收敛负例，不能用其成功退出判为完整协同能力通过。
- 不提交、不推送、不更新版本号；原用户工作区不迁移、不上传。
