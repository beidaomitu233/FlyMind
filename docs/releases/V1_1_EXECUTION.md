# v1.1.0 实施与验收台账

2026-10-20。开发分支 `codex/v1.1-development`。本文记录实现证据，不等同于发布公告。

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

复用 `/root/dev_application`、`/root/dev_engine`，gpt-6.1-sol / medium，不按任务重建。共享文件独占，代理自测后由 PM 审查、退回或验收。

Node 20 ABI 匹配 SQLite；测试使用 `C:/nvm4w/nodejs/node.exe` 和临时数据库。不重编用户依赖、不清理含真实工作区的 `output/playwright/review-session/`，不修复/重置 Docker Desktop。
