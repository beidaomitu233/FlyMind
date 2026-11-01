# U39 图形打开性能核查与限定修复

日期：2026-11-01开始，2026-11-02跨日复核。状态：**本地HTTP、字体按需及重活隔离已完成限定验收；用户已授权提交推送和Actions发布，首提交a2df854已推送，候选验证中；生产仍不可达，尚未晋级。**

## 用户反馈与验收口径

用户确认首次打开和连续切图均需7–8秒，期望恢复简单图1秒、复杂图2秒。计时终点必须为正确图形当前XML及原生可编辑状态，不以静态预览或提早隐藏loading代替。区分真实公网、公开资源代理和本机已预热样本，不把U31的本机单次325/448ms说成公网SLA。

用户后续说明已删除全部图形，授权创建新样本查看。仅在独立“加载性能验证”任务组创建新样本；不恢复、搬迁或删除原图。小图已确认保存；复杂图写入结果未知，恢复前不得换ID重建。

## 来源与测量结论

- 实际上线业务源为52b0f82，U31比较基线2d4a27a。Host/Viewport/controller/library/资源路由没有回退；固定版本URL、math=0、两槽复用和欢迎预热仍在。MCP guide刷新不在网页选图入口中，不能归因为页面每次下载完整提示词。
- 原U31验收已明确冷启动/保存退出和公网边界；本轮不能仅凭有限本机已热测试证明用户报告错误。
- PM完整gzip GET实测：app.min 2,220,672字节、TTFB1.367秒、总6.966秒；完整OTF字体13,596,506字节、TTFB0.133秒、总37.673秒。HEAD仍200/immutable/gzip只能证明策略存在，不能证明字节下载快。
- 真实Host加载公开资源、业务与身份在私有fixture的代理测试：全冷双槽准备42.705秒；预热后小图466ms、技术24节点1002ms、PBS944ms、240节点宽树2162ms、大图回小2126ms。第二槽主要资源transfer为0，热切无configure/init。该测量保留公网字节传输，但不是生产用户页面端到端/P95。
- 纯本地第二轮：小图337ms、技术401ms、PBS425ms、240宽树929ms、回小354ms。首轮及代理首存/协同重基较慢记录均保留，不挑最好结果冒充全部达标。引擎专项见[u39-engine-loading.md](u39-engine-loading.md)。

## 本地限定修改

1. `CloudIdentityGuard`只共享同guard、同team当前尚未完成的me请求；完成/失败立即清理，无TTL身份缓存、不跨身份/团队复用，失效仍阻止请求。一条业务AbortSignal不取消另一条业务共享的身份检查。
2. `NativeSaveSession.open`并行发起已绑定工作区的health和get；两者完成且根身份、能力和记录身份均验证通过才构建会话，不修改保存、恢复、协同重基或草稿状态机。
3. 真实回环HTTP每响应固定150ms：旧版me→health→me→get串行695ms，当前一次me后health/get并行325ms。只证明减少等待成本，不声称已解释或解决全部7–8秒。

PM实际执行：

```text
node --import tsx --test --test-concurrency=1 tests/cloud-client.test.ts tests/native-session.test.ts tests/drawio-host.test.ts tests/drawio-loading.test.ts tests/native-layout-feedback.test.ts
npm run build
```

**79/79、无跳过，完整build通过，173个预编译模块。** 日志`output/u39-pm-regression.log`/`output/u39-pm-build.log`，延迟HTTP证据`output/u39-opening/http-chain.json`。不包含未发布U35字体/renderer性能草稿，也未强改固定vendor或字体供应。

## 线上样本与可用性异常

- 准备并校验了8节点流程和24节点技术图。只发起一次小图create：`id=u39-perf-small-20261101`、`requestId=u39-create-small-20261101`、`taskName=加载性能验证`。MCP约160秒返回isError，没有取得saved/revision/job的可确认回执；保存是否成功未知。复杂图未创建，没有重试或换ID。
- 期间本机readyz12秒超时。独立只读[Actions41324537126](https://github.com/beidaomitu233/FlyMind/actions/runs/41324537126)同时确认域名DNS路径和固定原IP均TLS握手超时；SSH TCP能连但4秒没有banner。尚未取得主机内存/CPU/磁盘/内核日志，不能认定OOM、字体或某次绘图是根因。
- 2026-11-02用户明确正在重启，要求等待10分钟。最早重试时刻为北京时间00:24:50（UTC2026-11-01T16:24:50Z），之前停止全部线上资源、图形API及公开代理请求；两个自有本地预览已退出。恢复后先读readyz及原样本ID，核对未知写结果，禁止盲目重建。
- 当前Chrome的URL无法由Computer Use可靠核验，原窗口检查停止，没有绕过限制抓cookie、附加浏览器调试端口或读取隐藏会话。实际用户连续切图7–8秒的完整瀑布仍未取得，不能以隔离图替代它。

### 重启后的复核

- 按用户要求等满10分钟后，公网ready恢复，实际release仍为`run-41224699831-1`，pendingWrites为0；OAuth元数据200、约116ms。
- 读取原小图ID用时413ms，确认revision=1、8节点/8边。随后严格重放原`requestId`和原创建参数，518ms取得原成功回执、原导出job `eb4d6117-466e-4633-aefb-8e75336f237e`，没有创建重复图。任务组为`group_task_aa353139051c906ff4f527c7a6a455b9`。这两个数值是API读取/幂等回放时间，不是网页可编辑时间。
- 24节点/14边技术图校验100分后，仅发起一次创建：`id=u39-perf-technical-20261101`、`requestId=u39-create-technical-20261101`，使用同任务组。MCP在160017ms后报告`timed out awaiting tools/call after 160s`；未获得保存/导出回执，未重试。随后公网ready连接5秒超时，SSH在banner阶段12秒超时。已停止生产写入。
- 用户两次确认的腾讯云二维码未得到SSH认证成功的可核验结果；原连接已转入密码/验证码后取消，没有自动输入密码或验证码。一次非交互只读连接也在banner阶段超时，结果留在`output/u39-ssh-batch-status.log`。本轮仍未取得主机日志，不能把扫码回复视为成功登录或把两次失联直接归因为OOM。

### 离线服务器链路审查

固定application代理仅审查源码，没有额外生产请求或渲染压测：导出池全局串行，普通任务失败即入failed；遗失租约最多3次，没有无限自动重建证据。风险是创建编译和部分SVG操作仍与HTTP同Node进程，同步重活不能由60秒setTimeout抢占。固定OTF源16,437,364字节，经base64约21,916,488字节；线上旧SVG字体封装之后还有多次DOM签名/资源检查，产物预算不是峰值内存预算。仓库service模板没有资源上限不代表实际线上unit配置。上述仅是需测量的代码风险，尚未证明现场内存耗尽、泄漏或失联原因；不混入未发布U35草稿。

## 主机间歇性卡死：新增保护与验证

用户后续确认控制台终端也卡住，要求同时修复整机间歇性卡死。独立只读[Actions41327882980](https://github.com/beidaomitu233/FlyMind/actions/runs/41327882980)于UTC16:44–16:45对域名和原IP均TLS握手失败，日志`output/u39-health-after-reboot.log`；UTC16:59停止绘图十余分钟后仍TCP连接超时。没有获得现场内核、cgroup或各服务资源记录，仍不能把代码风险说成实际根因。

### 有界隔离

- 新增固定操作的Node子进程：compile/patch/configure、editor/collaboration normalize、SVG字体封装与完整SVG元数据检查。DB事务、幂等回放、修订CAS、合并和制品登记保留父进程。子进程不拥有数据库或Chromium，不能动态执行调用者代码或模块。
- 全局一个计算槽、至多4个等待，总截止默认30秒（含排队），CPU死循环由父进程终止；失败不自动重试写入。不延长原导出总截止，沿用AbortSignal取消迟到工作。
- 子进程V8 old-space 256MiB；启动前采用主机MemAvailable、当前实际unit/container及祖先cgroup剩余的较小值。compile等预留256MiB、SVG384MiB，另保留128MiB；运行期100ms采样RSS，超预算或实际余量跌破128MiB终止任务。采样不是OS硬RSS配额，Windows不宣称与Linux RSS监控等价，也不能限制其他应用。
- Chromium启动和新渲染上下文前增加512MiB可用余量准入。它是保守策略，不是已测浏览器峰值或系统级配额；低余量时明确拒绝，保留图形和既有成功制品。
- SVG子进程保留线上原有的独立资源检查和字体SHA核验，即使使用当前本地U35字体函数也不会省略该信任边界。U35原有文件改动保留且未自动纳入发布；当前新隔离接口与其原/新函数签名兼容。

### 受限复现与实际交付

`output/u39-isolation/report.json`固定单child、heap256MiB、15秒上限：24节点/14边编译墙钟662ms、阶段CPU672ms、峰RSS约103MiB；52b0f82原SVG字体函数的最小中文图封装墙钟530ms、CPU203ms、峰RSS约166MiB，输出21,916,807字节。本机没有复现160秒或整机卡死，这些数值只能用于保护预算和阶段对照。

PM执行SVG/导出15项全部通过，覆盖完整XML/固定字体、外联拒绝、取消、幂等快照、CAS、超时、租约过期和历史制品保护。新增取消会使迟到prepare提前失败，原测试已改成验证该明确取消，而非等待已取消制品继续完成，没有增加产品超时。

真实固定Chromium导出首次受到内存准入拒绝（当时未采集余量，不能推定原因）；随后不改阈值、不豁免保护，独立采样复验成功：PNG27,658字节、SVG21,922,718字节；中文与完整OTF保留，自有PID退出和profile清理通过。`output/playwright/u39-isolated-export/report.json`、`output/u39-export-memory.json`记录该成功轮最小可用余量约1.92GiB、父进程峰RSS约324MiB。它不是服务器现场内存或全进程树峰值。

## 下一步

### 本地最终集成记录

- 浏览器按需字体已通过专项验收，详见[u39-browser-fonts.md](u39-browser-fonts.md)。固定draw.io保存会预取fontCss所有URL，因此最终由同源Host独立head style供应，不能把95片放进Editor.fontCss。三例实际字体body约1.04/1.29/1.45MB，保存/切图/重开不全拉且热加载新增字体请求0；覆盖44,810码点，默认后台仍完整原OTF。PM另查看重开/导出PNG确认文字正常。
- 完整整合首轮144项中143项通过，1项发现新的通用错误脱敏把固定`EXPORT_RENDER_INVALID`变成`HEAVY_ENGINE_FAILED`；已改用已知NativeRenderError类型，未放开未知异常路径。修复后重活/SVG/导出相关24项全部通过、无跳过；其余已通过项没有对应实现变化。日志`output/u39-integrated-tests.log`和`output/u39-final-protection-tests.log`保留首轮失败及复验，不抹去记录。
- 最终完整build通过，181个预编译模块。纯正式JS入口、不带tsx执行24节点/14边compile→normalize→SVG元数据校验成功，645ms；`output/u39-compiled-smoke.json`。新增3组回归已加入默认test、test:cloud和既有候选CI门槛，未触发生产发布。
- 最终云端HTTP/MCP补验14/14、无跳过，包含真实Streamable HTTP SDK、Java授权、创建/PNG/修改/资源链；使用隔离团队库，日志`output/u39-final-cloud-tests.log`。
- 发布前排除U35的固定52b0f82旧字体实现复核：最小未嵌入中文SVG+完整OTF，在heap256MiB/15秒的单child里完成原封装、独立完整资源检查和解码字体SHA核验，墙钟733ms、峰RSS约217MiB、exit0；`output/u39-isolation/verified-baseline-svg.json`。仅调整该output副本的本地错误类型import，不改原算法。证明隔离接口可使用发布基线函数，不表示覆盖复杂图全部峰值。
- 实际Chromium导出及生命周期验证通过；低内存准入曾正常拒绝一轮，恢复余量后未放宽阈值即成功，见上文。原U35 SVG性能草稿仍保留，新子进程再执行部署基线的独立资源/font SHA检查，不能把未分离草稿悄悄发布。

服务器恢复后先读取前次启动的内核/cgroup/各服务资源与错误日志，核对未知复杂图的原ID/修订/导出job；禁止重复创建。然后才进行受控低负载原样本和实际网页计时，不能用本地样本宣称线上已修复或确认OOM。用户确认服务器4核/4GB，尚未确认再次重启恢复；需要看各服务实际峰值，不能只按规格宣布内存不足。SSH和控制台终端均失联时无法由当前会话远程操作。冷下载仍有约3MB编辑器脚本交付成本，未实现CDN，不能承诺现有网络任意冷图2秒。

### 已授权发布准备

用户已明确“允许，验证通过后通过Actions发布”。首提交`a2df854e671463bb386aa46c5bd031191e059de3`已推送，候选41330573394、Verify41330573424开始验证。最终发布审查发现core文本CRLF/LF来源摘要不一致，窄修统一LF与manifest/生成TS摘要并加source gate，95片字体二进制全部SHA保持不变；定向4/4复验通过。后续以修正提交的独立候选为准，旧候选不晋级，不改版本/tag/SQL/账号或数据；应用发布仍走Actions，主机恢复前不盲目发起生产晋级。
