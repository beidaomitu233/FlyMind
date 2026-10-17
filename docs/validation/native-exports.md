# D04-B 不可变原生导出任务与制品服务

状态：项目经理已验收指定范围，决定及独立证据见 [台账](../DEVELOPMENT_TRACKER.md#d04-b-与阶段联合验收决定)。日期：2026-10-16。仍为隔离数据根的 native pilot，未切换默认入口、未操作用户当前数据库。

## 实现与文件

- `server/exports/types.ts`：任务、不可变快照、租约、清单与五种文件类型。
- `server/exports/artifacts.ts`：五制品封装、格式/尺寸/摘要/mtime 验证、独立目录与原子发布、已登记文件读取。
- `server/exports/worker.ts`：单并发 worker、心跳、全尝试硬截止、租约 fencing、异常与关闭。注入 renderer/制品准备方法仅用于独立验证；生产使用 A 的 `NativeDrawioRenderer`。
- `server/application/native-exports.ts`、`server/store.ts` 的导出专用扩展：同一 SQLite 的 `native_export_jobs`、快照 CAS、requestId 幂等、领取/续租/成功/失败、显式重试及资源授权。未改变旧图存储/迁移/旧 SVG 制图行为。
- `server/native-routes.ts`、`server/runtime.ts`：native API、项目本地共享资源 router、后台 worker 与正常停机。
- `NativeStudio.vue`、`native-studio.css`、`native-client.ts`、`native-types.ts`：低频导出菜单、保存前置、任务状态/重试/五文件下载。轮询按会话及 job 隔离，组件卸载后不再续开轮询。没有第二套页面制图实现。
- 测试 `tests/native-exports.test.ts`；探针 `scripts/probes/native-export-runtime.mjs`、`native-export-browser.mjs`。

## 公共 API

所有 mutation 沿用 `X-FlyMind-DataRoot-Id`，缺失/失配为 `409 WORKSPACE_MISMATCH`，事务内再次读取持久工作区身份。

| 接口 | 请求与返回 |
|---|---|
| `POST /studio-api/native/diagrams/:id/exports` | `{expectedRevision,requestId,options?}` → 202 job |
| `GET /studio-api/native/exports/:jobId` | queued/running/succeeded/failed、快照 revision、`isCurrentRevision`、错误；成功后实际 exportedAt/width/height/scale 与五文件 URL/名称/bytes/SHA256 |
| `POST /studio-api/native/exports/:jobId/retry` | `{requestId}`，仅失败任务，创建新 job/exportId，沿用原不可变 snapshot/options，返回 `sourceJobId` |
| `GET /studio-api/native/exports/:jobId/files/:format` | 仅 `png`、`svg`、`drawio`、`json`、`project.json`；成功登记且图仍存活/身份有效才读取 |

options 严格只接受 `scale:0.1–4`、`background:'white'|'transparent'`；实际 scale 由 A 按预算降比并记录。未知字段、旧格式、过期修订、删除/永久删除和错根明确拒绝。相同 requestId+payload 返回同一任务；同 key 改 payload 拒绝。重导出新 requestId 创建新 exportId 和实际导出时间，不更改图形 revision/createdAt/updatedAt。

任务状态不包含原始业务快照、租约 token 或本机路径。旧修订导出明确带原 revision/`isCurrentRevision:false`，不会写入共享“最新预览”。

## 持久化与发布边界

1. 项目/XML 异步校验在事务外；短事务内复查工作区、存活、格式、expectedRevision 与完整快照，冻结 v3 JSON。任务快照保存在同一 `flymind.sqlite`，未另建导出业务库。
2. SQLite 领取事务限制整个数据库同时只有一个未过期 running 租约；owner+随机 token+期限+attempts。进程失联后可领取过期任务；连续三次过期转显式失败，用户重试另建任务。
3. 默认租约 15s、attempt 硬截止 60s。整个 validate→render→project→制品准备→发布→完成 pipeline 与 abort 竞争，每个异步边界、发布前后检查 signal 和绝对 deadline。事务拿到后再查当前实际时间，防忙等/事件循环阻塞跨过截止仍成功。
4. 超时会独立退出 attempt、停止心跳并登记失败；文件系统操作可能不能取消，晚到文件仅留在不公开目录。任何新 owner/token 都能阻止旧 worker 登记成功或失败。显式 stop 同样中止当前尝试并关闭 renderer。
5. 每个 attempt 写入 `artifacts/{id}/r{revision}/exports/{exportId}/.{leaseToken}.pending/`。PNG 用 sharp 核验真实格式/像素；SVG 核验 XML 与正尺寸；XML/JSON 来自同一快照。对五文件逐一落盘、fsync、回读及 SHA256，文件名复用 `core/export-metadata.ts`，mtime 与实际 exportedAt 一致。
6. 清单原子改名，再将整个暂存目录改为唯一 `{leaseToken}/`，最后 fencing 事务登记成功。目录存在本身不构成访问授权。资源读取复查 SQLite 成功状态/身份/存活、白名单、真实路径、清单一致性、bytes/SHA256/mtime，且只提供 attachment；未登记、失败、损坏或迟到文件不返回。
7. `.drawio` 保留快照完整 XML；`.json` 是纯内容 schema1，不带 rendering；`.project.json` 是完整 schema3。A 返回的 nativeXML 仅用于内容 hash/几何样式签名核对，不替换源文档。

## 页面与进程生命周期

- 明确导出时，先 `commitAndCaptureXML()`，再等待保存队列成功且 clean/backedUp，随后以确认 revision 创建任务。保存失败时不调用导出 API，也清掉旧任务的文件链接，仅保留恢复下载。
- 菜单标注 rN、历史修订/不含未保存编辑、运行/失败状态；失败任务可显式重试原快照。导出提交的响应丢失时保留原 requestId/payload，重试提交复用同一请求，不改 key。
- Runtime 根 mount A 的 `runtimeAssetsRouter()`，供应本项目固定 vendor、Chromium151 和字体，无父目录/系统浏览器 fallback。
- Runtime 持有 HTTP server 和 worker，SIGINT/SIGTERM 注册等待 worker/renderer close 的停机过程。隔离探针通过仅 `process.connected` 可用的父子私有 IPC `flymind-test-shutdown` 正常关闭，无 HTTP 停机入口。Windows probe 不以 `child.kill()` 充当正常退出；超时仅 force 自己的 child 并把验证判失败。

## 实际验证

在 `D:/AIBuilder/PM/flyMind` 运行：

```powershell
node --import tsx --test tests/native-exports.test.ts tests/drawio-native-storage.test.ts tests/native-session.test.ts
npm run build
node --import tsx scripts/probes/native-export-runtime.mjs
node --import tsx scripts/probes/native-export-browser.mjs
```

- 我方目标回归 **40/40**；新导出测试 **10/10**。证据 `output/playwright/native-exports/target-regression.log`、`test.log`。Windows 沙箱对原子 rename 返回 EPERM，按已授权的隔离验证申请 escalated 后同命令通过，未用非原子写法绕过发布约束。
- PM 联合执行曾发现故障注入测试 100ms 前置预算在并发构建时不足，已仅调整测试：目标阶段前留 2s、租约 5s、checkpoint 用真实 10s wall-clock 宽限；event-loop 分支同步阻塞 2.25s，仍验证实际超预算失败与晚到不登记。renderer 超时测试也明确先观察 render 进入，避免只覆盖前置校验超时。生产硬截止未放宽。
- PM 已独立默认回归 **184/184**、构建通过；证据 `output/playwright/project-manager-d04-test-final.log`，以及 PM 保存的 `project-manager-d04/runtime-result.json`。本报告不代替 PM 最终指定范围验收。
- 我方构建通过，证据 `output/playwright/native-exports/build.log`。

### 注入 renderer 的测试

测试使用合成 20×12 PNG/SVG，明确属于调度/封装测试，不作为真实业务图形渲染证据。覆盖请求幂等与 payload 改变、CAS/不可变快照、五文件摘要和 mtime、文档时间不变、两 worker 全局单渲染、租约过期/重启/尝试上限、旧 owner 迟到、渲染超时、制品 prepare/publish 超时和同步阻塞、失败新 job 重试、删除/错根、文件白名单和损坏。失败不提供旧成功图片。

### 真实无前端页面 Runtime

最终使用 A 稳定 renderer、项目固定资源和新 OS 临时根。**未打开任何前端页面（frontendPagesOpened=0）**，通过实际 HTTP/native worker：

- 创建脱敏 PBS，排队 r1 导出期间将图改为 r2；r1 五制品仍来自原快照且明确为历史制品。
- r2 透明/0.5 比例导出，核对实际 PNG 尺寸、全部五制品 bytes/SHA256/文件名/mtime，重新投影 `.drawio` 与校验完整 project，纯 json 不含渲染；导出前后正式图形记录不变。
- 同 revision 重导出新 ID/实际时间；旧请求重放同任务、改 payload/错根拒绝；未知资源格式与未登记 job 拒绝。
- Runtime 关闭、重启后读取持久任务与文件；**两次 graceful shutdown=true**，未触发 force fallback。

证据：`output/playwright/native-export-runtime/result.json`、`runtime.log`、`output/playwright/native-export-runtime-run.log`，以及 result 中两个 job 目录下的实际五制品。全部位于已忽略测试输出。

### 真实页面导出

项目 playwright-core + 固定 Chromium **151.0.7922.34**、真实 Runtime/Vue/IDB/native editor：五组检查通过，`pageErrors=[]`、`externalRequests=[]`、`gracefulShutdown=true`。

1. 实际双击改文字，尚未提交时点击导出，确认先 commit/保存至新 revision 再创建任务。
2. 菜单显示五文件并下载真实 PNG。
3. 中断 editor-save 网络后，导出按钮不会新增任务或继续提供旧图链接，远端修订不变。
4. 下载包含最新 XML 的恢复数据。
5. 精确重试保存成功后，可导出新修订。

证据：`output/playwright/native-export-browser/result.json`、`runtime.log`、`download.png`、`recovery.json`、`save-failure.png`、`export-success.png`，另有 `output/playwright/native-export-browser-run.log`。已查看成功与失败界面截图。

## 尚未包含

- MCP facade、自动启动/单实例/会话凭据属于 D05；本轮没有增加另一套工具名称，也未改旧 MCP 默认数据路径。
- 本轮只验证当前原生泳道，其他模板仍属 D07。真实 renderer 字体/像素一致性由 A 的 D04-A 报告提供独立证据；本报告不以注入图像冒充该验证。
- 真正操作系统强杀中途崩溃由持久租约/重启受控测试覆盖；正常真实 probe 只走优雅退出。物理磁盘耗尽、断电和原子 rename 的平台故障未做破坏性实测。
- 孤立暂存/迟到目录目前保留且不可公开，未添加自动垃圾回收；页面未增加完整历史导出列表，已知 jobId 可用持久 API 读取。备份/迁移/保留策略后续阶段再统一。
- 未提交、推送、改版本、变更台账或自行宣告 D04 完成。请求项目经理验收 D04-B 指定任务/制品/API/页面范围。
