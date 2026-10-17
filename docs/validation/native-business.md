# D07-B1/B2 业务能力接线与文件导入

日期：2026-10-16。状态：实施中；B2 底座已自测，B1 等 A 五型/configure 冻结后集中交验。不代表 D07 整体验收。canvas-only（B3）尚未实施。

## 路径与契约

- `nativeDocumentCapabilities()` 复用 A 的版本化 `drawioCapabilities()`，为 Runtime 握手、NativeClient、MCP schema/guide 和页面提供同一实际矩阵；未启用的类型/profile 功能不提前公布。
- 共享 NativeDiagramService 的 create/read/AI patch/full update 保留原质量、CAS、幂等与不可变快照导出语义。完整 update 继续语义 diff→patch；configure 使用独立 mutation operation/request hash，通过 A configureDrawio 生成实际 XML，正式验证内容不变后再提交。
- 原 MCP 18 名保留；configure_rendering 增加稳定 requestId，使用真实应用服务并等待该保存修订的 PNG/五制品。get_rendering_config 返回真实 profile/preferences 与该类型能力。
- `server/application/native-imports.ts`、`server/imports/source.ts` 负责人工单图业务导入；source 与 mutation receipt 在 create 同一短事务登记。新顶层 ID 由首次绑定的 workspace 身份和 requestId 确定性派生，内部业务/cell ID 保持，不继承源 revision、workspaceGroupId 或请求回执。
- NativeStudio 仅增加按实际支持集合的类型选择、低频 JSON 文件导入与同键重试；原泳道简单创建、Host/session 保存队列不替换。

## 导入 API 与字节预算

`POST /studio-api/native/imports`，必须携带绑定身份 header：

```json
{"format":"content 或 project","data":"原文件字节的规范base64","requestId":"稳定请求键"}
```

原始文件最多 **2,500,000 字节**；JSON 请求最多 **4,000,000 字节**；生成/导入后的 XML 最多 **4,000,000 字节**。严格 UTF-8；BOM 只在 JSON 解析时处理，保存和下载仍是原字节及其 SHA256。`GET /native/capabilities` 明确同一预算与当前导入范围。

- content 必须为严格 schemaVersion1（含源 id），新身份内容经对应 profile 编译。
- 完整业务 v3 必须通过正式双层校验，再调用 A rebindDrawingProject；新创建/更新时间，保留人工几何、样式和装饰。
- 完整业务 v2 先调用 A previewLegacyMigration/convertLegacyMigration，无损映射后再重绑。blocked 不写图、不以纯 content 重编译代替旧手工渲染。
- 人工导入允许结构合法的历史质量草稿；响应及页面明确报告原质量，不冒充 AI 新建准入、不补猜测关系。
- 完整工作区备份不属于单图 JSON 导入；必须继续走 D06 专用校验/恢复。drawio、压缩、多页及 canvas-only 本批明确不支持，不降级为假业务 content。

原始文件在 `artifacts/<newId>/imports/<importId>/source.json`，旁附不可变 manifest。先持久写本请求独有 staging，再原子发布来源目录；并发同键若已有相同、完整且核验通过的来源则复用，不能覆盖或删除对方已发布文件。文件发布失败无图；DB 失败可留下未登记来源，但没有下载权限，不能冒充已成功导入。来源下载 `GET /native/diagrams/:id/import-source` 仍要求当前有效图形和登记来源。

`native_import_sources` 记录来源格式、原文摘要/大小、源身份与路径。D06 validateWorkspace 同时校验来源登记/文件/manifest；原文件在 artifacts，完整备份包含它。恢复保留来源审计，导入 operation 的旧 mutation 回执沿用 epoch 屏障，不跨工作区重放。

## 已执行的定向验证

### 测试

- `node --import tsx --test tests/native-imports.test.ts tests/native-business-service.test.ts`：当前底座 **8/8**（导入5、服务矩阵3），通过 BOM 原文、新身份/时间、v2/v3 内部 ID 与逐 cell 几何/样式保留、完整v3重绑后真实结构patch、同键并发、root 异步竞态、文件发布/DB创建故障无半图且无可下载孤儿、来源备份恢复/旧键拒绝。
- `tests/native-business-service.test.ts`：3/3，按当时实际矩阵验证 health/schema/guide 一致、共享 AI create/read/patch/update/CAS、configure 未开放时明确拒绝。**此时仅 swimlane 已开启，不据此称五型/configure 成功。**
- `tests/native-mcp.test.ts` 11/11；`tests/native-session.test.ts` 19/19。旧“固定仅泳道/永远 configure=false”断言随真实矩阵更新，保留原请求/错误/恢复检查。
- 中间稳定泳道版本 `npm run build` 通过（vue-tsc、server tsc、Vite）。后续 A 类型模板仍在实施，最终类型/build/联合结果待冻结后更新。

### 真实页面窄探针

`node --import tsx scripts/probes/native-business-import.mjs`，固定 Chromium151、真实 Runtime+Vue、OS 临时独立根：最终 **4/4**，空 pageerror/外网请求，graceful-exited、tempCleaned=true。

1. 实际文件选择上传带 BOM 的 content JSON，HTTP 下载原文件逐字节相等。
2. 原生编辑器实际双击文字、输入、提交与 CtrlS；API revision 增加且读回新文字。
3. 实际上传完整 v3：来源是已验收 G1 `ui-round1.project.json` 的真实人工几何快照；明确是只读来源文件，不称为本轮新拖动。新身份导入后所有内部 cell parent/geometry/style 签名相同，PBS 38 分及原四问题保留并报告。
4. 实际上传含手工位置的 v2 项目，经 A 迁移后逐 cell 对照，保留旧几何。

证据：`output/playwright/native-business-import/{result.json,imported-human-edit.png,human-record.json,legacy-project-imported.png}`。首轮额外在小型图复用 moveResize，因真实几何未变而硬断言失败；保留 `attempt-01-extra-drag`，没有放宽断言、改产品或把该手势报成功。正式本批的原生交互证据是实际文字修改。

## 待最终交验

`scripts/probes/native-business-sdk.mjs` 已准备、仅语法检查，尚未运行。它要求 A 明确五型/configure/migrate 全启用后，才集中运行默认 SDK tools/list/schema/guide、五型 AI 创建/patch/full update、实际 configure→保存→真实 PNG/五制品、幂等/CAS、各型 v2/v3 项目导入及真实 Vue content 文件导入/原生文字编辑。完成后补最终结果和限制。

B3 后批将包含无假 content 的 canvas-only 记录、四制品及显式业务属性映射/校验/新修订转换；本批不实现其联合记录、renderer 或导出类型。生产数据及上级 pm.db 未触及，无提交、推送或版本更新。
