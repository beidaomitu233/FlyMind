# U40 renderer lifecycle — local evidence, pending PM review

## Change and scope

`server/cloud/start.ts` previously called `renderer.ready()` and retained Chromium until application shutdown. Per-export contexts already closed, but this did not release the browser process tree. `NativeDrawioRenderer` now closes its browser after 5 seconds without an admitted render; cloud startup calls `ready({keepBrowser:false})`. Readiness still starts the fixed browser, checks its real version, and on Linux uses `chromiumSandbox:true`; it then releases it before accepting requests. Each later export starts it on demand. No dependency, SVG/font packaging, resource validation, export budget or drawing content changed in this slice.

Browser close and launch are serialized. A new job waits for idle close to settle; a late old disconnect cannot clear the replacement. Active jobs postpone idle cleanup. Cleanup failure is retained and rejects a later acquisition instead of creating another browser. Terminal close cancels the idle timer and owns startup/cleanup. Default `ready()` remains a prewarm call, now subject to the same idle deadline. The constructor's optional `browserIdleMs` is bounded 1–60000; production uses 5000.

## Reproducible measurement

`scripts/probes/renderer-memory.mjs` uses no database, credentials or production requests. It sequentially exports a 2-node Chinese flow and the full technical reference (24 nodes/9 groups), followed by three further small exports, waits 6.5 seconds, exports again, then closes. All six exports must finish with the renderer's strict content/geometry/resource checks. PNG and raw, unembedded native SVG are retained. No forced GC or V8 heap limit is used.

Historical source snapshots were exported read-only with `git archive 52b0f82 server src package.json` and `git archive c6ec126 server src package.json` under `output/u40/`. They use the same existing Node20.19.6 dependencies (no runtime dependency changes between these revisions) and the same fixed local Chromium/OTF assets via explicit `assets`. This measures the renderer subsystem, **not a whole deployed application/Java/Redis stack**. Current/after compilation uses the same content and compiler. No Linux binary was rebuilt.

Exact snapshot commits: `52b0f826aebdcef58f004a648d824763bcb6485f` (published baseline) and `c6ec126605b62dc00b7af255a56992b29bcdc6cc` (U39 source, **not deployed at measurement time**). All renderer transitive relative imports under `server/` and `src/` in these two snapshots, including `svg-fonts.ts`, assets, library, controller, validation and (for c6ec) CPU child modules, come from that exact Git archive. The uncommitted working-tree U35 `svg-fonts.ts` is **not** used by either archived baseline. Shared node_modules/tsx and actual fixed resource files are the only external supply; the runtime font SHA and browser version are checked normally. The probe itself imports the current compiler/project builder solely to prepare identical input documents; it passes assets explicitly to each snapshot renderer. This is a renderer-component comparison, not three full cloud-service starts.

The `final-idle-after` variant runs the live working tree with the U40 renderer/start change; its CPU child can therefore include the pre-existing uncommitted U35 SVG implementation. That dirty file was preserved, not edited or accepted as part of U40. Consequently the comparison establishes browser residency/removal, actual restart and identical PNG output, **not a causally isolated reduction in SVG packaging or Node peak memory**. No such peak reduction is claimed. All runs use the same real OTF, default scale=1, small and technical contents. The raw native SVG files are retained and byte-identical across all three runs: small SHA256 `799540d5e298075096e52c923cf676bcac5e4bdcff9545ceccf17132f4583ca9`, technical SHA256 `c90477bb67273535aae5eccd7b48e516c29cbd14e87eec792aa9321bc27f9da1`. Browser absence after idle is directly recorded in the process list. The three measurement processes ran sequentially, without forced GC; the other agent was asked to defer its heavy measurements until completion.

Run a snapshot by setting `FLYMIND_RENDERER_SOURCE` to its root and `FLYMIND_PROBE_OUTPUT` to an isolated output directory, then:

```powershell
C:/nvm4w/nodejs/node.exe --import tsx scripts/probes/renderer-memory.mjs
```

Final reports: `output/u40/final-baseline-52b/report.json`, `output/u40/final-current-before/report.json`, `output/u40/final-idle-after/report.json`. Earlier non-final reports included the PowerShell sampler itself; they are superseded. Final sampler explicitly excludes its own PID and descendants.

## Actual Windows working-set results (MiB)

| Phase | 52b Node / Chromium / tree | c6ec Node / Chromium / tree | after Node / Chromium / tree |
| --- | --- | --- | --- |
| startup ready | 254.8 / 107.7 / 369.4 | 247.3 / 106.7 / 360.9 | 241.3 / 0 / 256.2 |
| first small export completed | 278.4 / 131.6 / 417.0 | 198.2 / 131.1 / 336.2 | 237.5 / 132.1 / 391.4 |
| technical24 completed | 327.7 / 132.1 / 466.8 | 293.4 / 131.4 / 431.7 | 169.8 / 132.4 / 324.1 |
| fifth export completed | 379.0 / 133.0 / 519.0 | 249.1 / 132.2 / 388.2 | 247.2 / 133.1 / 402.2 |
| idle 6.5s | 196.9 / 133.0 / 336.8 | 199.9 / 132.2 / 339.1 | 247.8 / 0 / 262.8 |
| export after idle | 371.7 / 133.0 / 511.6 | 242.6 / 132.3 / 381.8 | 210.8 / 131.8 / 364.5 |
| renderer closed | 372.3 / 0 / 372.3 | 243.2 / 0 / 243.2 | 211.3 / 0 / 226.3 |

The demonstrated lifecycle benefit is zero owned Chromium processes after startup validation and idle, instead of three processes retaining ~132 MiB plus the Windows console-host overhead in this sample. Some source-tooling Node/esbuild processes also appear in the tree column. Node GC timing differs: do not claim that all differences in Node RSS result from browser recycling. The main Node `process.resourceUsage().maxRSS` values were 441.7 / 404.7 / 329.0 MiB respectively; these are single-PID lifetime peaks, not simultaneous process-tree peaks. Reports also retain per-process `PeakWorkingSetSize` and stage RSS snapshots. They do not establish an OS-enforced memory ceiling.

Windows working sets can double-count shared pages. These are not Linux PSS, cgroup memory, or measurements of the user's reported ~1.06 GiB. No production access or OOM attribution was made. Linux sandbox launch/reclaim and aggregate production service memory remain independent deployment checks. Active rendering still needs Chromium plus a CPU worker; this change primarily removes idle browser residency. An export after idle pays a fresh browser startup cost.

## Output and tests

后续补充：Playwright 的 context/browser 关闭可能无截止时间。候选在上下文清理超时后中断共享浏览器的任务并有界关闭；若不能确认浏览器已关闭，禁止启动第二实例。有关迟到上下文和清理失败的测试为模拟测试，不能证明处于内核 D 状态的真实进程必然退出。非公式图现向编辑器传入实际 XML 以避免不必要的 MathJax 加载，公式图保持启用；尚未取得当前组合变更的真实 PNG/公式回归证据。PNG 消息在 SVG 封装前解码并释放 base64 引用，但 V8 何时回收不可保证，尚无独立峰值对比。

本次继续调整渲染顺序：完成原生 SVG、PNG 和 PNG 尺寸校验后，有界关闭当前 context，然后才启动 SVG 字体工作进程；取消和 finally 复用同一个关闭 Promise，失败沿用共享浏览器退役隔离。关闭前或关闭期间发现外联/页面错误时不启动工作进程，工作进程后仍复查。独立模拟测试27/27及组合测试通过，覆盖正常与并发任务、取消、卡住、旧 context 迟到及外联错误；不代表真实 Chromium 进程的页面内存已立即归还操作系统，也没有真实峰值对照。若 SVG 本身无效且同时存在外联，提前拒绝可能改变两种错误的优先顺序，两者仍均拒绝交付。

后续补充：context 绑定所属浏览器代际，旧代迟到不得关闭或中止新代；若 context 自身关闭失败、但所属浏览器已确认关闭，已导出的当前结果可以继续封装。可用内存低于 SVG 重活既有512 MiB准入线且当前任务独占时，先有界释放浏览器，再执行原有重活准入；未跨过门槛依然拒绝。压力路径下新浏览器等待本次 SVG 工作进程实际 close，渲染外层超时/取消不会提前解除等待；等待者取消和 renderer.close 不会迟到创建浏览器。模拟及微型 Node 子进程联测48/48通过，未启动 Chromium；该栅栏不覆盖其他独立重活、无法保证全进程 RSS 或系统总内存上限。

PM 在工作区隔离临时目录串行运行 85 项字体、导出、MCP 和生命周期定向测试通过；后续 PNG 引用调整后，单独运行 renderer 两个测试文件 19/19 通过，服务端 TypeScript 检查通过。扩展云联调在允许本地回环和临时链接的环境下 69 通过、1 跳过、1 失败：真实浏览器导出在 SVG 工作任务的内存准入处返回 `HEAVY_WORK_MEMORY_LOW`。此联调意外包含真实浏览器，未对进程树连续采样，不能证明整个测试过程低于800 MiB；禁止绕过准入重跑或将这一项算作通过。最初沙箱内同组测试另有回环和 Windows 符号链接权限失败，环境许可后这些测试已通过。

All three runs succeeded. Small, technical and post-idle small PNG bytes are identical across runs:

- small/restart: 25457 bytes, SHA256 `625a2bea2889531374b2496b84804ce0d43fd3ca7c76aba1ffdc357e77e9489c`
- technical24: 282239 bytes, SHA256 `53083ba1e9ba8ee27b0c5d0b24f925ea4614733e11b0e0d6b610bb0577016bb9`

Raw SVG for the other agent's CPU packaging analysis: `output/u40/final-current-before/small.native.svg` (6271 bytes), `technical.native.svg` (88194 bytes). They have no embedded canonical font.

```powershell
C:/nvm4w/nodejs/node.exe --import tsx --test tests/renderer-lifecycle.test.ts tests/drawio-renderer.test.ts
npx tsc -p tsconfig.server.json --noEmit
```

15/15 targeted tests passed; server typecheck passed. Unexpected disconnect also enters the same close fence without dropping the old handle first; duplicate/late events are harmless. Cleanup failure after Linux version/closed checks is fail-closed too, retaining the browser handle for terminal cleanup. Coverage includes unexpected disconnect/pending owned cleanup, unowned cleanup failure, idle release, active reservations, acquisition during close, cleanup failure fail-closed, readiness release/default prewarm, pending startup close, and existing renderer resource/font/output validation. All probe-owned browsers and HTTP listeners exited. No commit, push, deployment or user-data change.
