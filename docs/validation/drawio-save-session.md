# D03-B2a 保存会话与恢复草稿

日期：2026-10-16。状态：**待项目经理验收**。本轮仅提供纯框架无关的客户端、保存状态机和 IndexedDB 仓库基础；没有修改 Vue、Host、engine、后端或 package，也未接触生产数据。

## Public interface

| 路径 | 导出与职责 |
|---|---|
| `services/native-types.ts` | NativeTransport、NativeRecord、NativeSaveRequest、DraftRepository、NativeDraft、NativeSessionSnapshot、NativeAcknowledgement 等类型，以及 NativeApiError |
| `services/native-client.ts` | NativeClient：health/get/list/workspace/saveEditor，调用已验收 B1 API，保留 status/code/currentRevision |
| `services/native-drafts.ts` | IndexedDbDraftRepository、草稿验证、键/guard helper、恢复下载数据 |
| `state/native-session.ts` | NativeSaveSession、recoverNativeSession |

Host 后续接入方式：

```ts
const session = await NativeSaveSession.open({
  dataRootId, diagramId, transport, drafts,
  onChange(snapshot) { /* 状态、错误、dirty 与 backedUp */ },
  onAcknowledged({ request, record, seq, hasNewerEdits }) {
    /* 只确认修订与业务身份；不把 record XML 重新 load 到当前编辑器 */
  },
})
await session.edit(latestEditorXML)
await session.flush()
// 明确重试：await session.retry()
// 切图/退出：await session.close()
// 恢复文件数据：session.downloadRecovery()
```

`edit(xml)` 更新并持久化最新编辑，不自行触发首次网络保存，Host 可防抖调用 flush。保存循环已经运行时，后续 B/C 合并为最新版本，确认 A 后自动用新 revision 提交最新 C。`close()` 立即使 generation 失效并保存恢复数据，不等待可能永久挂起的网络响应。新页面/新图创建另一个会话，不复用旧 sessionId。

`snapshot()` 提供 dataRootId/diagramId/sessionId/generation/baseRevision、latestXML/latestSeq/acknowledgedSeq、dirty/backedUp/status/error 和原样的未确定请求。传输层可注入，测试使用受控 Promise；状态机不依赖 Vue、DOM 或绘图引擎。

## 保存确定性

- 只允许一个请求在途。请求创建后固定 `requestId + expectedRevision + xml`，发送前先成功持久化最新草稿及该请求。
- A 成功仅推进 baseRevision 与 acknowledgedSeq。latestXML 始终是用户最新编辑；A 返回的 canonical XML 只通过 ack 回调提供，状态机不会用它覆盖 B/C 或发起 load。
- 网络错误、5xx 或不完整响应表示提交结果未确定。保留原请求 A，flush 不盲目提交新内容；显式 retry 先确认工作区身份/存活，再用完全相同的请求确认 A，随后才能提交 C。
- 409 保留最新 XML，不自动覆盖远端。404/410 保留恢复内容并阻止原身份重建；NativeSaveSession 不含 create 操作。`NATIVE_PILOT_DISABLED` 的 404 单独作为暂不可用处理，不误报图形删除。
- 400/422 投影失败保留最新 XML 和未变 baseRevision；用户修正后使用新 requestId 继续。若修正 B 已在失败 A 后排队，直接提交 B，不丢弃它。
- 相同 XML 不增加本地 seq 或请求。服务器确认 native no-op（revision 不变）后，本次提交的 XML 被确认干净，不因服务器返回的序列化差异再制造 dirty。
- 真实 ack 后即使 IndexedDB 清理失败，也不重发已确认请求；状态显示草稿错误，重试只补做持久化/清理，必要时再保存较新的内容。

`backedUp` 仅在当前 journalVersion 成功写入或精确清理后为 true。配额不足/不可用会显式拒绝，不退回内存仓库冒充已备份。下载接口返回 filename、MIME 和完整 JSON 文本，包含最新 XML 及未确定请求，B2b 再接浏览器下载动作。

## IndexedDB 键与原子迁移

草稿键为 `[dataRootId, diagramId, baseRevision, sessionId]`。同一个读写事务同时操作 `drafts` 与 `sessions`：检查 generation/journalVersion/latestSeq guard，移除该会话先前键，再写新 baseRevision 键或清理当前草稿。清理后保留不含业务 XML 的 guard，阻止旧异步写重新生成草稿。

旧 ack 的清理不能绕过 session 和序号守卫；冲突/删除时，即便最新 XML 已回退到旧 acknowledgedXML，也保留恢复数据，避免远端已经改变后把本地版本误当作可丢弃。

没有读取或回放旧 localStorage。

## 恢复分叉与源草稿策略

`recoverNativeSession(options, draft)` 先读 health，再确认原图存活与 revision。返回：

- `ready`：无未确定请求且基准 revision 匹配，返回保留最新 XML 的会话；不自动发送。
- `pending-retry`：原请求仍未确认；允许在同一工作区先精确重试该请求，不能用最新 C 改写 A 的 key/revision/XML。远端已经增加修订也只通过原请求幂等确认或 CAS 冲突解析结果。
- `conflict/deleted/workspace-mismatch`：返回原草稿、错误与可下载数据，不写回服务器，不重建原 ID。

每次恢复都创建全新本机 sessionId；原 pending 的服务器 requestId/expectedRevision/XML 原样保留。两个标签页同时恢复时，各自的本机草稿隔离，仍由同一服务器幂等记录和 CAS 仲裁。一个分支的确认不能清理另一个分支。

**源草稿保留，不由恢复分支 ack 擅自清除。** B2b 需在恢复列表提供显式“移除本机草稿”低频操作，按精确 key+guard 清理，且不能删除正式图形。恢复列表不应每次打开都自动重放或强制弹出同一源草稿。

## 实际验证

```powershell
node --import tsx --test tests/native-session.test.ts
node node_modules/typescript/bin/tsc --noEmit --target ES2022 --module ESNext --moduleResolution bundler --strict --skipLibCheck src/drawing/services/native-client.ts src/drawing/services/native-drafts.ts src/drawing/state/native-session.ts tests/native-session.test.ts
```

最终 **18/18 通过**，无跳过；目标 TypeScript 检查退出码 0。证据：`output/playwright/native-session/test.log`、`typecheck.log`。

受控测试覆盖：A 在途连续 B/C、丢失响应后完全相同 A 重试、409、404/410、pilot 暂停、400 后修正与在途修正、草稿写失败先于网络、已确认提交后的清理失败、关闭及跨会话迟到 ack、刷新恢复、恢复键随 revision 迁移、并发恢复分叉、源/另一个分支不被旧确认删除、工作区身份/修订不匹配、相同 XML/native no-op、客户端错误契约及 IDB 不可用错误。

测试使用显式注入的内存 DraftRepository 与延迟 transport，没有调用真实服务或读取用户数据库。内存仓库用于验证状态机时序及 repository 契约，不作为运行时 IDB 失败后的替代方案。

## B2b 验证门槛与未验证项

本轮没有运行真实浏览器 IndexedDB；真实 IDB 的事务键迁移、配额/blocked/error、标签页并发及刷新后读取必须在 B2b 浏览器验证，不以受控仓库测试代替。真实文件下载、Vue 列表/恢复菜单、DrawioHost 事件/metadata ack、切图和 IME/视口行为也尚未验证。

本轮未增加后端 API。后续 Host 应在打开/恢复时使用 health 的持久工作区身份，渲染最新编辑并按 ack 协调绑定，不能把本地草稿当正式图形列表或使用旧 localStorage 回灌。

未提交、推送或更新版本，未自行启动 B2b；保留当前代理会话等待项目经理验收。
