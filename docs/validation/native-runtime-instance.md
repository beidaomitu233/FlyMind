# D05-A 原生 Runtime 生命周期与会话验证

日期：2026-10-16。范围：显式 native pilot、隔离数据根；已由项目经理验收指定范围，见 [验收台账](../DEVELOPMENT_TRACKER.md)。本记录不代表 G1 或默认入口切换。

## 实现与公共接口

- `server/runtime-instance/{types,config,origin,lock,protocol,boot,session,client}.ts`：按需后台、原子数据根锁、有限等待/崩溃恢复、固定能力握手、本机会话与显式停止。
- `server/runtime.ts`、`server/start.mjs`：先隔离根检查和端口绑定，再初始化 SQLite/服务；装配失败清理自己的 HTTP/锁。路由尚未装配时返回 `503 RUNTIME_STARTING` 和 `Cache-Control: no-store`，避免早到健康请求永久悬挂。
- `src/drawing/services/native-client.ts`、`native-types.ts`：浏览器同源 bootstrap、HttpOnly cookie、不可变工作区身份、一次受控会话重试。原有 nonpilot 行为保留。

Node 入口：`ensureNativeRuntime(options?)` 返回 `baseURL/dataRootId/instanceId/sessionToken/capabilities`，以及 `headers()`、`authenticatedFetch(relativeAPIPath, init?)`、`close()`。options 支持 dataRoot、privateRuntimeRoot、port、env、projectRoot 和 1–30000ms 启动预算（默认20秒）。`close()` 仅分离客户端；不停止后台。`authenticatedFetch` 只允许当前连接 `/studio-api/` 相对路径，强制绑定 Bearer/root、拒绝重定向，调用方不能覆盖绑定身份。URL origin 使用标准化结果，含80默认端口边界。

能力严格匹配当前应用版本、API1、project3、draw.io31.5.3、adapter1、swimlane-standard1、supportedKinds=[swimlane]、configureRendering=false及原生写入/导出标记。canonical rootPathId 是目录身份；dataRootId 是 SQLite 工作区身份，两者不能互相替代。先公开 challenge/HMAC 校验，再发送 Bearer；错误应用/版本/根/实例不复用。

## 锁、凭据与关闭决策

- `.flymind-runtime.lock` 用 mkdir 原子占用，owner 带 PID/instance/nonce/root；启动者向子进程转移租约。未知活 PID、非法 PID、异应用 owner 保守拒绝，不结束其他进程。
- 失效锁用该目录内 recovery guard、宽限/稳定内容复核和原子 rename 恢复。覆盖 mkdir 后未写 owner 的崩溃点；旧 lease 不能删除新 owner。恢复仅删除已验证属于旧实例的凭据文件。
- 凭据独立保存在私有目录，文件0600，Unix目录0700；Windows默认用户 LOCALAPPDATA/FlyMind/runtime 继承用户目录权限。全部实际验证均注入新建 OS temp privateRuntimeRoot，没有写真实 AppData/用户配置。Windows自定义目录的ACL需由部署者保证属于当前用户；本轮未声称实现跨用户ACL治理。
- 随机 token 不进入 stdout、URL、健康响应或普通 connection JSON；stderr只进私有实例诊断。health/challenge/session bootstrap 明确是公共例外；字体/editor静态资源公开，不含用户图形。pilot 数据 API 使用 Bearer 或实例专属 HttpOnly/SameSiteStrict/path=/studio-api cookie；cookie签名绑定当前工作区。pilot旧 `/artifacts` 403，避免旧制品下载绕过鉴权。
- PM批准显式 `requestNativeRuntimeShutdown(connection)`：仅 pilot、Bearer、精确 instanceId/root，cookie单独请求403；响应202完成后顺序关闭 worker/browser/HTTP/自己的锁和凭据。不是MCP工具，不在MCP退出或close时调用。原私有父子IPC保留。探针仅停止自己记录的实例。

## 验证

命令在项目根执行，网络/临时目录原子操作获本机审批；首次沙箱限制的失败不算功能结果。

| 命令 | 实际结果与证据 |
| --- | --- |
| `node --import tsx --test tests/drawio-native-storage.test.ts tests/runtime-instance.test.ts tests/native-session.test.ts` | 40/40；`output/playwright/runtime-instance/target-tests.log`。含10生命周期/会话单测、11存储、19保存会话；覆盖初始化前拒绝、HMAC/版本/根、损坏guard、旧lease、快速spawn失败、早到503、post-bind失败、坏SQLite装配失败、非HTTP端口占用、浏览器身份不重绑、默认80 URL。 |
| `npm run build` | 通过（vue-tsc/server tsc/Vite）；最后仅server origin/启动503窄修后另跑 `npx tsc -p tsconfig.server.json --noEmit` 通过。 |
| `node --import tsx scripts/probes/native-runtime-instance.mjs` | 本人首轮12项通过；PM加入旧浏览器退出断言后独立最终13项通过，0用户页面、tempCleaned=true。`output/playwright/runtime-instance/lifecycle.json`，PM副本 `output/playwright/project-manager-d05/runtime-instance-result.json`。 |
| `node --import tsx scripts/probes/native-studio-browser.mjs` | 21/21；`output/playwright/native-studio/result.json`、工作台截图；执行日志 `runtime-instance/studio-regression.log`。同路径更换DB身份后旧读取也拒绝，通过临时SQLite只读检查revision未变。 |
| `node --import tsx scripts/probes/native-export-browser.mjs` | 5/5，gracefulShutdown=true；`output/playwright/native-export-browser/result.json`、export-success.png、实际下载；执行日志 `runtime-instance/export-ui-regression.log`。 |
| `node --import tsx scripts/probes/native-export-runtime.mjs` | 6/6，0用户页面，两次 graceful=true；`output/playwright/native-export-runtime/result.json` 与五制品/hash；执行日志 `runtime-instance/export-runtime-regression.log`。 |

真实生命周期证明：两个独立客户端进程并发得到同一后台PID/instance；客户端退出仍可导出；错根端口和错版本服务拒绝且不创建SQLite；cookie/Origin/错instance/root停止边界；SIGKILL自己Runtime前记录其浏览器PID，崩溃后旧浏览器全部退出，重启保留工作区和revision；显式关闭新Runtime同时清理新浏览器/锁/凭据。任何仍存活的本次浏览器PID会使探针失败并报告，只针对本次记录PID做兜底清理。

## 边界与未决

- 不启用默认pilot，不迁移/测试生产库，不创建常驻自动任务。共享Runtime没有“最后客户端退出就杀后台”策略。
- 这是同用户本机进程协议；不防同用户恶意进程读取用户私有文件。未知活PID/无法验证的损坏owner可能需人工处理，优先不偷锁。PID复用时保守等待或错误，未实现OS进程创建时间证明。
- 固定端口冲突明确失败；port0允许测试/调用方按需发现，同根再次连接须保持配置一致。无全系统端口扫描或机器Chrome回退。
- 本轮全套联合回归与最终验收由PM完成，B的MCP facade/deep link另有独立报告。

## 联合验收退回修复：启动失败返回与子进程退出

PM联合回归210项中209通过，坏SQLite用例清理private目录出现ENOTEMPTY。确认原客户端收到 `flymind-runtime-error` 即抛错；此时子进程仍可执行末尾stderr/退出，调用方清理会与它交错。

本次仅修改 `server/runtime-instance/client.ts`、`tests/runtime-instance.test.ts` 与本报告：spawn后立即注册该自有child的exit/close终止Promise；确定启动失败（IPC、spawn error、提前exit、启动装配catch）先最多额外等待5秒终止，再释放失效租约并返回原错误。Windows IPC disconnect后的close回调可迟滞，已退出的exit也是有效终止证据；父进程自己的log fd此前已关闭。失败错误附非枚举failedChildPid便于诊断/断言，不含凭据。超时返回STARTUP_SHUTDOWN_TIMEOUT，保留仍活租约，不杀进程、不重复spawn；这5秒是失败收尾预算，附加于原启动等待预算。

真实坏SQLite用例现在明确断言failedChildPid已退出、端口可重新监听、owner已清理。新增确定性夹具发送错误IPC后再等350ms写stderr/末次文件并退出：ensure必须等其PID退出且末次文件存在才返回，随后无锁残留。没有只靠rm重试掩盖活动进程；清理helper仍保持原实现。

- `node --import tsx --test tests/runtime-instance.test.ts`：11/11，`output/playwright/runtime-instance/test-failed-child-close.log`。
- `node --import tsx --test tests/drawio-native-storage.test.ts tests/runtime-instance.test.ts tests/native-session.test.ts`：41/41，`output/playwright/runtime-instance/target-failed-child-close.log`。
- `npx tsc -p tsconfig.server.json --noEmit`：通过。
- 本次未重跑大probe；早期close-only诊断测试驱动已按记录PID和命令行复核清理，不触共享Runtime。新增1用例，PM下一轮默认套件预期211项。

## 联合验收补修：ready失败时关闭已启动worker

`runtime.ts` 的worker引用提升到startup catch可见范围；启动catch先等待worker.close，在finally确保boot.close，清理异常不替换原始启动异常。覆盖ready写私有凭据失败时，已认领队列的worker不继续运行或保留活导出租约。

新增用例直接 `node --import <临时只读spawn观察器> server/start.mjs --runtime`（不走launcher）：临时SQLite预置queued job，privateRuntimeRoot指向普通文件，在ready阶段实际EEXIST/ENOTDIR失败。断言child退出1、原错误code保留、stdout空；queued任务确已认领一次并failed/EXPORT_WORKER_STOPPED，leaseOwner/leaseUntil清空且旧租约不可用；无Runtime锁、端口可重新绑定。只观察该Runtime自己spawn的浏览器PID并检查全部已退出；若无浏览器启动则不把该用例宣称为已实际启动浏览器后的视觉回归（既有lifecycle有实际浏览器退出证据）。任务保留历史leaseToken用于fencing，不将其误认为活租约，也不修改B的store实现。

`node --import tsx --test tests/runtime-instance.test.ts`：12/12，`output/playwright/runtime-instance/test-startup-worker-cleanup.log`；server tsc通过。新增1用例，连上前次补修，PM默认联合套件预期212项。本批未运行大probe。
