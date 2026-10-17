# D06-B 显式迁移提交、完整备份与离线恢复

日期：2026-10-16。状态：项目经理已验收D06指定离线维护范围；独立真实恢复10项、最终联合245/245及构建通过。活服务入口仍待D08/G2。

## 实现边界

- `server/application/native-migrations.ts`、`server/migrations/**`：只读预览及同库显式转换提交；消费 A 的纯转换器，不复制 scene/XML 转换实现。
- `server/backups/**`：在线一致数据库备份、制品/固定供应校验、离线恢复计划与组件切换、显式中断回退及维护 CLI。
- `server/store.ts`：迁移短事务/来源记录、恢复 epoch 请求屏障、历史成功导出来源绑定，以及打开数据库前的恢复 marker 写保护。
- `server/runtime-instance/boot.ts`：持有同一数据根锁后、store.init 前检查恢复 marker；未完成恢复时 fail-closed。
- 未新增 HTTP/MCP/UI 恢复入口；未修改通用 UI、A 的迁移器、应用版本或 package。默认测试入口由 PM 加入。

仅对自有 OS 临时数据根验证。用户生产 `data/`、上级 `.local-data/pm.db` 未触及。

## 迁移契约及事务

`NativeMigrationService.preview(id)` 使用 `better-sqlite3` readonly/fileMustExist 连接读取原始记录；不调用 init、connect 或 schema migration。返回源 envelope 和 A 的预览。数据库原文 SHA256 与 A 的规范化 sourceHash 分开记录。

`commit(input, expectedDataRootId)` 输入为：

```ts
{
  diagramId, expectedRevision, expectedRawDocumentSha256,
  expectedSourceHash, expectedGeometryDigest, converterVersion, requestId,
  expectedWorkspaceGroupId, expectedDeletedAt, expectedSavedAt
}
```

事务外重跑 `convertLegacySwimlane`、正式 validateDrawingProject/XML 投影并核对源纯 content；blocked 或未映射阻断项不提交。短事务先核对 workspace 身份及幂等键，再复查完整原文、SHA、revision、createdAt、savedAt、分组及 deletedAt。提交同 ID 的 v3 和 revision+1，原 createdAt/updatedAt 不变，savedAt 记录迁移时间。原 v2 历史保留；trash 不变活动，tombstone 不重建。

`native_migration_records` 保存原始 source_raw/source_revision、源双摘要、目标 revision、转换器版本、geometryDigest、诊断报告及幂等结果；`schema_migrations` 记录显式 schema 扩展版本 2。恢复仍保留此来源表，旧回执的可重放性由 epoch 屏障控制，不能把迁移审计当临时回执删掉。

同键同载荷重放返回原快照；同键异载荷拒绝。预览后源记录或组织状态变化，返回 MIGRATION_SOURCE_CHANGED。源时间不合法保留为 blocked，不自动修复旧样本时间。

## 完整备份

`createWorkspaceBackup({sourceRoot, backupRoot, projectRoot?})`：

1. 禁止默认生产根；备份根与源根分离。readonly SQLite online backup 生成一致副本，不裸拷贝正在使用的 WAL 数据库。
2. 复制完整 artifacts 文件树，保留每个文件的相对路径、大小、SHA256 和 mtime。拒绝符号链接/目录越界；复制期间文件消失或变化则失败，不发布缺文件的“成功备份”。
3. 在副本检查 integrity/FK、全部 mixed 文档及历史、当前 revision 的 document/savedAt 与历史相等、任务 snapshot 对应同修订历史。成功登记任务逐一验证五文件、磁盘 manifest、摘要和 mtime。
4. 已合法 purge 的任务仅在存在 tombstone 且 diagram/history 均移除时列入 `retiredJobIds`。保留数据库审计，不要求已删除文件、不创建恢复绑定、不能读取或复活；无 tombstone 的缺图/缺文件仍失败。trash 的五制品照常完整校验。
5. 记录固定供应：draw.io 官方供应清单/实际全部 3446 个 vendor 文件、浏览器实际文件树及 Playwright registry、固定字体和许可 SHA256。供应树读取有 16 个并发上限，不减少校验范围。
6. `.backup_*.pending` 内完成验证和持久写清单后原子 rename 发布 `backup_*`；失败保留暂存诊断，不能当成功结果返回。

清单 `requiredSupply='matching-local-installation'`：本格式包含应用数据、制品和供应指纹，**不包含整个浏览器/vendor 安装包**。恢复前本机必须具备精确匹配的固定供应，缺失或不匹配明确拒绝；不能仅凭 `.sqlite` 宣称完整恢复。Runtime 私有凭据不备份。

## 离线恢复与中断边界

`planWorkspaceRestore` / `applyWorkspaceRestore` / `recoverWorkspaceRestore` 都通过现有 acquireRuntimeLease 取得与新 Runtime 相同的数据根互斥锁。有活实例则 RESTORE_RUNTIME_ACTIVE，不杀进程。此 CLI 只管理遵循新锁的隔离 Runtime；不声称能管理不遵循该锁的旧进程，旧服务须明确关闭后再复制。

计划绑定已验证备份清单摘要与目标全库状态摘要。目标摘要覆盖所有 table 行、table/index/trigger/view 定义及制品路径/内容/时间。源备份和目标任一变化均拒绝旧计划；暂存完成后再复查一次，避免用回滚抹掉新编辑。

数据根和 `.flymind-runtime.lock` 保持原位置。保护目录 `.restore-protection/<restoreId>` 保存切换前数据库、WAL/SHM（如存在）及完整 artifacts；新组件在 `.restore-staging/<restoreId>` 校验好后切换。每个组件都记录原/新摘要，journal 以相对固定组件路径持久写入并 fsync，逐组件 rename 后更新阶段。

中断时保留 `.flymind-restore-journal.json`、保护目录和暂存目录。所有 DiagramStore 开库入口及 native boot 均拒绝 marker，避免初始化或旧写入口写入半恢复库。`recover` 先核对所有组件的真实摘要，再在同锁内回退；不凭 phase 猜测 rename 是否发生。journal 路径只允许本次固定保护/暂存目录和四个组件，拒绝符号链接/越界。审计记录已写但 journal 未删时再次 recover 可完成，不被 wx 文件存在卡住。

恢复旋转持久 workspace identity；新 Runtime 发放新实例凭据。旧客户端/IDB 草稿的身份失配，不能继续写入。旧 mutation 回执归档；migration 来源表原样保留但请求键屏蔽；所有旧 export 请求键亦屏蔽为 REQUEST_EPOCH_CHANGED，避免全局 unique request_id 误重放。

成功历史导出的 job/snapshot/manifest/文件原字节不改。`restored_export_bindings` 绑定 job、原 dataRootId、目标 dataRootId、规范 manifest 摘要和 restoreId；资源读取核对当前身份与绑定后仍执行原五文件验证。再备份验证来源链，后续恢复将绑定压到新的目标身份。queued/running 旧任务改 failed/RESTORED_INTERRUPTED 并清租约；不自动续跑，也不把旧失败任务当新工作区可重放请求。

## CLI

须显式 `FLYMIND_NATIVE_PILOT=1`，没有默认数据根。使用 `node --import tsx server/backups/cli.ts`：

```text
backup  <isolated-root> <separate-backup-directory>
plan    <isolated-root> <published-backup> <new-plan.json>
restore <isolated-root> <plan.json>
recover <isolated-root>
```

plan 输出文件使用 wx，不覆盖已有确认计划。restore 不隐式停服务，调用前需关闭该 Runtime。完成与回退审计、保护目录保留供审查；不自动删除用户备份或新修改。

## 实际验证

### 定向测试

实际命令：`node --import tsx --test tests/native-migrations.test.ts tests/native-backups.test.ts`。原先沙箱阻止临时制品原子 rename（EPERM），相同隔离命令获准重跑。最终 **7/7 通过**（34.3 秒，含完整供应树核对）；`npx tsc -p tsconfig.server.json --noEmit` 通过。PM 另执行默认联合测试。

- 迁移预览数据库状态不变；提交时间/ID/分组/原始历史及幂等保留；旧写入口拒 v3。
- 源删除状态改变/错根拒绝且无半写；新预览明确迁移 trash 后仍在 trash。
- 未适配类型 blocked，不创建迁移 schema。
- 全制品备份；编辑及 schema 变化均令旧恢复计划失效；恢复保留 mixed/history/group/trash/tombstone，旋转 identity、屏蔽旧请求、验证历史制品并再备份。
- 受控故障位于“DB 已换、artifacts 未换”：boot、store.init/update 均被 marker 阻止且零写；显式回退；再注入“已写回退审计、journal 未删”后重试成功。
- 活锁拒绝维护；合法 purge 的旧 job 不绑定/不可下载/拒 ID 重建；queued 旧任务清租约。
- 缺失登记制品不发布成功备份；路径遍历和供应指纹不符拒绝。

制品单测使用明确注入的 mock renderer（20×12 PNG），不声称是真实 draw.io 渲染。

### 真实 Runtime / 真实渲染

实际命令：`node --import tsx scripts/probes/native-backup-restore.mjs`。最终运行从 2026-10-16 10:56:27Z 开始，`output/playwright/native-backup-restore/result.json`：10 项全 true、0 用户页面、3 次自有 Runtime graceful 退出、tempCleaned=true。

1. 脱敏 PBS 经正式 v2 创建、只读预览、显式同 ID 转换到 r2；业务时间、源原文、23/26 及原质量问题保持。
2. 实际后台渲染 migrated PBS，PNG 1898×3310，五格式均通过 HTTP 内容/摘要核对。
3. Runtime 在线时完成 DB+制品+固定供应完整备份。
4. 离线预览后重新启动并产生 r3 新修改及新制品；旧计划恢复被拒绝。
5. 新计划恢复 r2，保护目录逐文件 inventory 与恢复前 r3 制品相等。
6. 新 Runtime 下旧 root header 明确 WORKSPACE_MISMATCH，不能写入。
7. mixed v2/v3、原 v2/r1 与 v3/r2 历史、分组、trash、tombstone 和原始迁移来源保留。
8. 原成功导出按恢复 binding 读取；旧导出 requestId 返回 REQUEST_EPOCH_CHANGED。
9. 新任务再次后台导出 r2，文档内容/时间不变；PNG SHA256 与恢复前相同。
10. 再备份并校验已恢复的来源映射。

证据：`migration-preview.json`（无业务原文）、`backup-manifest.json`、`before-backup.png`、`newer-before-restore.png`、`after-restore.png` 及 result 中三组 job 的五制品摘要。最终探针保留了原 `native_migration_records.source_raw` 的相等断言，恢复没有丢掉迁移来源审计。

## 未完成及请求验收

请 PM 验收本批服务/存储/备份与离线恢复边界及真实探针。D08/G2 仍需显式停服务/维护入口与 UI；尚不提供活 Runtime 原地恢复。物理断电、磁盘硬件故障、外部不遵循锁的进程写入未实测；受控异常/崩溃窗口测试不冒称物理断电保障。恢复可能保留失败暂存、journal 与保护目录，必须显式处理，不能静默启动或覆盖。

其他类型迁移等待 D07，PBS 来源业务缺陷仍原样保留。生产数据及上级 PM 数据未迁移、未合并。
