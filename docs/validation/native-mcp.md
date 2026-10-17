# D05-B 原生 MCP 交验

日期：2026-10-16。仅隔离临时库，未提交、推送或改版本。D05 指定范围已由项目经理验收，见 [验收台账](../DEVELOPMENT_TRACKER.md)；G1 两轮真实交替及默认切换不在此结论内。

## 接口与数据边界

- `server/mcp.ts` 在任何 store 初始化前选 pilot 分支；旧实现原样移至 `server/mcp-legacy.ts`。native facade 复用 A 的 `ensureNativeRuntime` / `authenticatedFetch`，不自建启动器，不记录凭据，退出只 detach。
- 保持原 18 个工具名与 flymind 资源用途。create/patch/update 必须稳定 requestId，content 必须 schemaVersion 1 与稳定 id；真实支持仅 swimlane。get 默认纯业务内容，v2 经 extractContent 只读；v3 正式投影校验后才报告 synced。get_rendering_config 返回真实 profile/preferences，configure_rendering 明确未支持，D07 接续。
- AI/manual receipt 的 operation 与有效 editIntent 分域。AI 新建质量须 passed 且无 error；修改比较 error/warning 的 code 家族、node/edge、severity 与可测规模。可测项包括文字、description、items、段落、判断条件、结束后续、重复主题；原子类型/孤立项按身份与严重性判等。只补 note 的默认结构修改拒绝。人工结构合法草稿可保存，PBS 缺口不推测修复。
- 完整 update 计算语义 operations，按依赖顺序修改，经最终业务等价断言，保留无关手动几何。节点/边数组的单纯排列不制造新修订；角色/阶段顺序仍有意义。
- mixed 组织操作仍同库，mutation 事务内 root guard。native export snapshot 只从同库历史版本读取，经完整校验及事务内历史 JSON 复核冻结；不收外部快照。旧 receipt 重放后所有图形元数据/图片锚旧修订，currentRevision/isCurrentRevision 独立。workspaceGroupId 是当前列表归属。

## 导出与资源

认证新增：`GET /native/exports/:jobId/snapshot` 仅返回不可变内容/时间/修订等锚定信息；`GET .../delivery` 逐一复用登记、路径、mtime、清单、摘要校验，返回五个真实绝对路径。public job 不含 path/lease/凭据。HTTP 上述前缀均为 `/studio-api`。

默认等待 25 秒，保存后导出失败/等待超时保留 saved=true、diagramId/revision/jobId。queued/running 用 export_diagram 的 jobId 继续等待，failed 用 retryJobId 显式重试，均保持原快照/options；不重建图。普通当前导出 CAS 不变。

STDIO 固定 8MiB 安全预算，使用默认 SDK 10MiB 读取上限验证。resourceLimits 为保守编码预算，resource_link 只含预算内文件并附 size；过大资源发出前抛 MCP_RESOURCE_TOO_LARGE，连接保持可用。过大 PNG 工具预览独立标 too_large，真实 exportStatus=succeeded 与 files/urls/resources 保留。内嵌完整字体 SVG 约 22MB，目前走已验证的本机 files/认证下载；未替换字体、裁图或假装默认 SDK 可内联读取。

## 实际执行

| 命令 | 结果/证据 |
|---|---|
| `node --import tsx --test tests/native-ai.test.ts tests/native-mcp.test.ts` | 15/15：服务 8 项、SDK 7 项。涵盖质量/纯内容/几何/依赖顺序/root/历史/CAS、真实 HTTP 错误 shape、旧 r1 retry/current r2、超限不炸连接 |
| `node --import tsx --test tests/native-exports.test.ts` | 11/11；增加 delivery 真实路径、未成功/损坏拒绝、failed r1→r2→retry 原快照。注入 renderer 单测，不称真实原生渲染 |
| `npx tsc -p tsconfig.server.json` | 通过 |
| `node --import tsx scripts/probes/native-mcp.mjs` | 真实 SDK STDIO + 真实 Runtime/renderer，无 Web 用户页面，15 项全绿；`output/playwright/native-mcp/result.json`，另保留 created.png/created.project.json 与五格式摘要。PNG 签名/尺寸、五个真实文件与资源、超大 SVG 可控拒绝后 get 正常、HTTP/本机/manifest 摘要一致、原生 XML 保存后 get/patch 保留几何、幂等/CAS/删除、历史 PBS、MCP 退出再连同实例。本次实例 graceful-exited、tempCleaned=true |
| `node --import tsx scripts/probes/native-mcp-deeplink.mjs` | 固定 Chromium 151，真实构建 Vue/Host 4 项全绿；`output/playwright/native-mcp-deeplink/{result.json,deep-native.png}`，截图已目视检查。v3 真实定向打开，v2/缺失/删除不建图，零外网。复用 A 构建，未并发 build；graceful-exited、tempCleaned=true |

探针 Runtime 数据与凭据目录在 OS temp，输出仅忽略目录。五制品由真实后台 renderer 生成；STDIO 探针的“人工保存”是受控 XML 改文字/几何后走正式 editor-save API，不冒称指针/键盘用户交互。真实原生拖动/文字/连线先前 D03 已验证，本轮深链仅验证选图宿主。

## 保留事项

- 仅 pilot，默认旧入口不切换，G2 尚未由本报告宣告通过；四类模板与 configure D07。
- 内嵌字体 SVG 体积保留，后续字体子集/WOFF2 优化另立范围。
- 深链验证为从 MCP 编辑链接打开新文档/页面挂载；本轮只获准 mounted 选图，不增加已挂载页面的 query watcher。
- 全量默认测试/build/最终联合回归由 PM 独立执行；本报告不替代 G1 复杂来源业务核对。

## D05-B 追加：MCP 存活期间 Runtime 故障恢复

PM 发现成功 connection Promise 永久缓存的恢复缺口，已窄修。JSON API、PNG、资源字节共用请求入口，网络/响应体读取失败或明确 401 只使对应缓存失效并 detach，不自动重放任何请求；错误要求沿用原 requestId/完全相同 payload 重试。业务 409/CAS/quality 不清缓存。连接重建保留首次绑定 dataRootId，换 instance 可恢复，换 workspace 拒绝且不改绑定。迟到旧连接失败按原 Promise 守卫，不清除新缓存。

- `node --import tsx --test tests/native-mcp.test.ts`：11/11，新增不确定写首次不自动重放/后续同键确认、401/业务错误区别、换根不改绑、迟到失败、PNG/资源头部与响应体故障。
- `npx tsc -p tsconfig.server.json`：通过。
- `node --import tsx scripts/probes/native-mcp-recovery.mjs`：同一真实 SDK STDIO 进程 5 项绿。先创建并导出，停本次 Runtime，首次同键明确失败且 SQLite 数量不变，第二次同键启动新 instance、同 workspace/revision/job，无重复记录。再停自有实例，仅修改该临时库 native_workspace_id 并启动自有新实例；旧 MCP 拒绝重绑，versions/receipts/diagrams 均不变，后续读取仍拒绝。`output/playwright/native-mcp-recovery/result.json`：空 stderr、graceful-exited、tempCleaned=true。

未重跑无关大探针，未开始 G1，原受控 XML 证据仍不称真实指针/AI交替验收。
