# D03-B1 原生文档存储与隔离服务

日期：2026-10-16。状态：**待项目经理验收**。范围为同一 SQLite 的 v2/v3 读取、原生事务服务、默认关闭的 pilot API 和本地 draw.io 静态路由；没有接 Vue/DrawioHost、保存队列或恢复草稿。

## 实现路径与接口

| 文件 | 本次职责 |
|---|---|
| `server/document-record.ts` | 统一格式判别、记录解码和 metadata；v2 返回兼容的旧瞬态文档，v3 返回完整项目 |
| `server/store.ts` | 同一 diagrams/diagram_versions 的 native 创建与 CAS 保存、幂等记录、混合读取；通用删除/恢复/移组 |
| `server/application/native-diagrams.ts` | create/get/list/workspace/saveEditor/patchContent；复用 A 的编译、归一化、投影及补丁接口 |
| `server/native-pilot.ts` | 初始化前的显式隔离根检查、工作区身份摘要 |
| `server/native-routes.ts` | pilot API、结构化错误、本地资源及私有路径防护 |
| `server/runtime.ts` | 最少挂载、health 能力与身份、通用组织路由 |
| `tests/drawio-native-storage.test.ts` | 临时目录中的服务、SQLite、真实 HTTP 与资源路径验证 |

没有新建图形库或另一个数据库。完整 v3 JSON 直接存入现有 `diagrams.document`，身份仍为 `content.id` 对应的原表主键，修订、历史、创建时间、分组、回收站和墓碑继续沿用原表。现有 v2 不自动转换；旧样本仍以 v2 存储。

新增 store 入口：`getStored/listStored/listMetadata/snapshotStored`、`getNative/createNative/commitNative`、`restoreStored/moveStoredToGroup`。旧 `get/list/snapshot/update/patch` 仍保持旧文档契约，遇到 v3 明确返回 `409 NATIVE_DOCUMENT_REQUIRED`，不会向旧画布提供一个丢失 XML 的降级文档。旧 HTTP 导出与 MCP 的旧渲染链同样被旧 get guard 阻止；本轮没有为 v3 宣称可用图片导出。

## Pilot 与工作区身份

默认 `FLYMIND_NATIVE_PILOT` 关闭。启用必须显式设置为 `1`，同时提供 `FLYMIND_DATA_DIR`；启动在创建/初始化 DiagramStore 之前检查根目录，拒绝默认生产 `data/`、其子目录及解析到该目录的路径别名。现有 localhost/Origin 防护继续适用。

pilot 启动或首次 native 创建在 SQLite `metadata.native_workspace_id` 持久保存随机 UUID。health 的 native `dataRootId` 为该 UUID 的稳定摘要，公开响应不含原始路径。同一路径重启保持身份；同一路径重建数据库产生不同身份，避免把旧草稿当成新库的相同 ID/revision。默认关闭且从未启用 native 的旧库不会为该身份额外写 metadata；其 health 暂用原有路径的不可逆摘要作为旧能力标识。

启用后可使用以下入口（`/studio-api/native` 前缀默认返回 `404 NATIVE_PILOT_DISABLED`）：

| 方法与路径 | 请求/结果 |
|---|---|
| GET `/diagrams` | 混合格式 metadata 列表，包含 format 2/3、身份、时间、修订及分组 |
| GET `/workspace` | 同一工作区的混合完整记录、metadata、groups、trash、deletedIds |
| GET `/diagrams/:id` | 原生记录；重新执行正式 v3 项目校验；v2 不自动升级 |
| POST `/diagrams` | `{content, requestId, profile?, preferences?, workspaceGroupId?}`；从内容编译原生项目 |
| POST `/diagrams/:id/editor-save` | `{xml, expectedRevision, requestId}` |
| POST `/diagrams/:id/content-patch` | `{operations, expectedRevision, requestId}`；只接受引擎严格语义操作 |

创建允许结构合法的人工草稿，因此 D01 PBS 的既有质量问题原样保留；D05 仍须补 AI 创建/修改的质量准入。本轮没有把 pilot 创建接口等同于正式 AI 准入。

组织管理沿用公共 HTTP 路由：移组使用 `moveStoredToGroup`、恢复使用 `restoreStored`，删除与永久删除继续使用既有 ID/revision/删除令牌。native 恢复保留全部 XML、原创建时间及分组，产生新修订；没有用旧 `projectDocument` 重写 v3。旧 MCP 组织方法仍待 D05 统一适配，不在此任务改 MCP。

## 保存、CAS 与幂等

1. 对调用者输入、请求 ID 和 payload 建立快照；内容/原生编辑的异步校验在事务外完成。
2. 编辑保存调用 A 的 `normalizeDrawioEdits(xml, baseProject)`；严格业务补丁调用 `patchDrawio`。候选项目都再经过 `validateDrawingProject`，重新投影核对双层业务一致。
3. 短同步事务重新读取当前记录，检查 ID、v3 格式、活动状态、创建时间及 expectedRevision。
4. `UPDATE ... WHERE id/revision/deleted_at/schemaVersion` 必须恰好修改 1 行；完整 v3、不可变历史与幂等响应同事务提交。没有在事务中 await 引擎或 Web Crypto。

native 修订冲突明确返回 `409 REVISION_CONFLICT` 和 `currentRevision`。删除/墓碑返回 410；旧格式/native 入口错配返回 `NATIVE_DOCUMENT_REQUIRED`；同一 requestId 改 payload 返回 `IDEMPOTENCY_KEY_REUSED`。归一化/投影错误使用引擎的稳定错误前缀作为 code，不提交失配项目。

`native_mutation_requests` 仅在 native 写事务中创建，按工作区全局 requestId 保留操作、规范化 payload SHA-256、diagramId 和完整已提交响应。相同请求跨服务实例、并发或后续修订重放，返回该请求原来的快照，不新增修订；同 ID 不同 payload 拒绝。回收站/墓碑会阻止迟到保存和重试使记录复活。永久删除通过外键级联清除该图的幂等快照，墓碑继续阻止原 ID 重建。

## No-op 的判断

服务不向 store 提供可信的“无修改”布尔结论。store 先在事务外计算已校验候选的渲染签名，再在事务内与当前 previous 的内容 hash、渲染签名和 preferences 比较。A 提供的 `drawioRenderSignature` 忽略视口 dx/dy/grid/page、根临时字段、XML 属性顺序/缩进及等价缺省 0；保留真实几何、层级绘制顺序、折点、样式和装饰。

完全相同、原生无操作保存或仅视图/序列化变化仅记录该请求的幂等响应，不改变业务 revision、savedAt 或 updatedAt。真实节点移动、样式或业务变化仍产生新修订。历史上的布尔提示参数即使被调用者额外传入也不影响判断，测试实际验证“伪造 true 不能吞掉编辑，伪造 false 不能制造无意义修订”。

## 本地引擎资源

pilot 开启时 `/drawio` 只映射 D01 核验过的 `../resources/drawio/vendor`。拒绝 WEB-INF/META-INF、隐藏目录、反斜线/盘符、重复编码和越界/符号链接逃逸。资源 CSP 的 connect/script/style/font/image 来源限于本地或必要 data/blob，服务不请求外网。没有把供应目录中的 WAR 私有配置直接暴露。

项目经理还独立让真实 editor 能力探针直接复用该 router/CSP，验证离线业务库插入、merge、非零视口/选区、Ctrl+S 和普通边元数据通过。证据：`output/playwright/drawio-host-capabilities/result.json`、`run.log`；命令 `node --import tsx scripts/probes/drawio-host-capabilities.mjs`。该探针不启动 DiagramStore/应用 Runtime；本代理未重复运行。

## 实际验证

实际命令：

```powershell
node --import tsx --test tests/drawio-native-storage.test.ts
node --import tsx --test tests/sqlite.test.ts
node node_modules/typescript/bin/tsc --noEmit --target ES2022 --module ESNext --moduleResolution bundler --strict --skipLibCheck server/native-routes.ts server/application/native-diagrams.ts tests/drawio-native-storage.test.ts
```

- 新增测试最终 **10/10 通过**、无跳过：混合 v2/v3、同表存储、分组/历史、旧入口拒绝、并发 CAS、跨实例及并发同请求幂等、原快照重放、payload 变化拒绝、原生无操作/视口差异、真实几何/样式编辑、事务内 no-op 复核、在途删除/迟到保存、XML 恢复、永久删除、防回灌、创建及修改事务故障回滚、PBS 人工草稿、工作区身份重建、默认关闭、真实 HTTP/Host/Origin、静态私有路径。
- 原 SQLite 测试 **3/3 通过**；目标 TypeScript 检查退出码 0。
- 证据：`output/playwright/drawio-native-storage/native-test.log`、`legacy-sqlite-test.log`、`typecheck.log`。中间失败日志保留为调试证据，不作为最终通过证据。
- 环境沙箱最初阻止本机回环，最小探针返回 EACCES；相同隔离测试在已授权的 require_escalated 下实际通过。测试全部使用 `mkdtemp` 数据根并在退出后清理，没有打开真实 `data/flymind.sqlite`，也没有指向上级 PM 数据库。
- 项目经理已独立运行此测试文件 **10/10 通过**；其记录在 `output/playwright/project-manager-d03/native-storage.log`。本段只引用项目经理已告知的证据，不自行宣布任务验收。

## 后续边界

待 B2：统一前端工作区适配、DrawioHost 事件与保存队列、工作区身份绑定的恢复草稿、迟到 ack/切图隔离、旧 localStorage 回放保护。当前旧 UI 遇到含 v3 的旧 workspace API 会得到明确拒绝，不把混合数据送入旧 hydrate；新 mixed 入口已就绪，但未宣称旧 UI 已支持它。

待 A1/后续联调：结构 patch 与归一化的完整编辑矩阵，本任务直接复用其入口，不复制实现。待 D04/D05：同引擎后台导出、MCP/HTTP 共享正式质量准入。待 D06：受控生产迁移、完整工作区恢复及 restore epoch；运行中手动替换数据库不作为本轮恢复功能。

本任务没有改引擎/core/UI/package/共享类型/台账，没有自动迁移 v2，没有提交、推送或更新版本。完成后保留当前代理会话等待项目经理验收和 B2 派单。
