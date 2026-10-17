# D03-B2b 原生工作台与真实草稿验证

状态：待项目经理验收。日期：2026-10-16。仅 `/native` pilot；默认入口与正式数据未切换。

## 实现与接口

- `src/drawing/ui/NativeStudio.vue`、`native-studio.css`、`src/router/index.ts`：独立原生泳道页面，服务端正式列表、创建、按会话挂载 Host、保存状态、手动恢复/下载/移除草稿。混合库中的 v2 显示“未迁移 · v2（只读）”，不提供未经验证的逐图旧版编辑链接。旧入口遇 v3 的既有 guard 保持，迁移仍属于 D06。
- 页面仅首次传 `initialXML`，`:key=sessionKey` 只在打开/恢复/明确重读时改变。XML 事件进入既有单请求队列；普通 autosave 防抖 700ms，Ctrl+S 立即 flush。成功响应只更新状态/修订/列表，不 load/merge/fit 编辑器。
- 切图、明确重读、显式下载使用 A2 的公开 `commitAndCaptureXML()`；普通 autosave 使用只读 `captureXML()`。导航抓取失败立即阻止离开，保留旧 Host；保存失败但已成功备份时，用户可明确确认保留草稿后离开。加载期间禁止编辑和会话操作。`beforeunload` 根据 dirty、未备份、抓取失败及 `hasUncommittedText()` 提示。
- `native-drafts.ts` 新增 `IndexedDbDraftRepository.remove(key, guard)`：一个读写事务精确比较当前 key、generation、journalVersion、latestSeq，匹配才删除，并推进守卫防旧写复活。恢复继续分叉新 sessionId，保留源草稿；不自动回放、不读取旧 localStorage。
- 显式下载必须成功抓取当前模型。若抓取成功但 IDB 写失败，可下载内存中刚捕获的最新 XML，并继续明确显示“未备份”；抓取本身失败时不下载旧快照冒充最新。
- `native-client.ts` 通过构造参数 `expectedDataRootId` 固定绑定打开时工作区；所有 native POST 带 `X-FlyMind-DataRoot-Id`，无绑定客户端在发送前拒绝。health 不会自动更改绑定。
- `server/native-routes.ts`、`application/native-diagrams.ts`、`store.ts`、`runtime.ts`：native POST 缺失/失配身份为 `409 WORKSPACE_MISMATCH`。身份传入 `NativeMutation.expectedDataRootId`，在既有 create/commit/replay 事务开始处使用同一 `workspaceDataRootId` helper 重读 SQLite metadata，先校验身份，再处理回执或业务修改。内部服务调用保留可选 guard 兼容。health 返回当前持久身份摘要，不暴露路径。
- `native-session.ts` 将 413 与 400/422 同列为明确输入拒绝，保留最新 XML、清除未提交的 A；修正 B 用未变化基准和新 requestId 保存，不盲重试超限 A。

## 实际命令与证据

在 `D:/AIBuilder/PM/flyMind` 执行：

```powershell
node --import tsx --test tests/drawio-native-storage.test.ts tests/native-session.test.ts
npm run build
node --import tsx scripts/probes/native-studio-browser.mjs
```

- 目标回归 **30/30**（存储/HTTP 11 + 保存会话 19），无跳过。证据：`output/playwright/native-studio/native-regression.log`。
- 构建通过（Vue/服务端 TypeScript 与 Vite）。证据：`output/playwright/native-studio/build.log`。
- 真实页面探针使用项目 `playwright-core@1.62.1` 与项目固定 Chromium **151.0.7922.34**，实际 Runtime、随机 localhost 端口、全新 OS 临时数据根、真实 Vue 页面与固定本地编辑器。仅通过 API 初始化脱敏 PBS、最小泳道和明确 v2 对照；不操作用户库。退出后关闭浏览器/Runtime 并删除经过路径校验的临时根。
- 浏览器 **21 项检查通过**，`errors=[]`、`externalRequests=[]`。证据：`output/playwright/native-studio/result.json`、`run.log`、`runtime.log`；截图 `pbs-native.png`、`saved-native.png`、`workspace-mismatch.png`；下载 `recovery-download.json`、`unbacked-download.json`。以上均在已忽略目录。

## 浏览器实际覆盖

1. 明确 v2 + v3 混合列表，v2 为无编辑链接的只读条目；脱敏 PBS 原生打开。
2. 真实双击文字编辑、指针拖动节点、原生连接箭头拖出业务边、Ctrl+S 保存；未用 graph/model API 替代用户操作。
3. HTTP 暂停 A，继续编辑 B/C，真实 IDB 保留 A 原请求和 C；A 确认后新 revision 提交 C，IDB 同一事务迁键且旧键不残留；最终清理确认草稿。
4. 非零视口、可见选区 SVG 几何保持；保存 ack 没有新增 load。切图后旧 A 响应不改变新图，关闭会话草稿可精确移除。
5. 网络中断后真实下载、刷新不自动回放；两标签页并发恢复形成两个独立分支并保留源，pending request 完全相同，一方 ack 不清理另一方。
6. 原生文字尚未提交时直接点另一图，导航专用提交边界捕获并保存文字；拦截公开 export 回复使 capture 超时，验证不能切图、不能下载旧快照冒充最新。
7. 外部修订产生真实 409，本机最新 XML 保留、远端不被覆盖；明确重读远端前保留草稿。
8. 在真实 IDB 事务中注入 `QuotaExceededError`，验证未备份显示、无业务提交，并能下载刚成功抓取的最新 XML；解除故障后重试成功。此为受控事务故障，并非填满物理磁盘。
9. 同一路径、同 diagram ID/revision 下改变 SQLite 持久工作区身份，旧绑定 POST 被拒绝，revision/history/receipt 均不变化。另有存储测试在异步 normalize 暂停期间改变身份，以及回执重放身份不符，均无半写。

## 限制与后续门槛

- Host XML 上限 5 MiB、HTTP JSON body 上限 4 MiB、服务 XML 上限 4,000,000 UTF-8 字节不同；JSON 转义也会增加体积。超限不是网络重试可解决的问题，需减少内容后以新请求保存，或下载恢复数据。
- 浏览器探针没有验证真实操作系统中文 IME、移动端、物理磁盘耗尽或浏览器升级阻塞；不以 DOM 文本编辑/受控配额异常冒充这些验证。A2 的公开未提交文字检测用于保守保护，不能承诺浏览器退出时保存 OS IME 缓冲。
- 冲突/删除草稿目前提供下载与精确本机移除，不自动复活原 ID；本轮没有“将任意恢复 XML 另存新 ID”的服务入口。正式列表不从草稿产生记录。
- 只支持当前泳道 profile；AI 内容质量准入、五类模板、迁移、全组织管理及最终 G1 闭环仍按 D05/D06/D07/D08/总体验收推进。未改旧 UI、Host/engine、依赖、版本或台账。
- 未提交或推送；请求项目经理验收本次 B2b 页面/保存/草稿/身份保护指定范围，不宣告整体 D03 完成。
