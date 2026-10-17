# D04-A 固定运行资源与原生后台导出

日期：2026-10-16。状态：项目经理已验收指定范围，决定及独立证据见 [台账](../DEVELOPMENT_TRACKER.md#d04-a-验收决定)。覆盖固定供应安装/诊断、共享字体与资源路由、后台原生 PNG/SVG renderer；五制品任务/发布由 B 负责，MCP 仍为 D05。没有提交、推送、修改应用/adapter 版本或访问用户数据库。

## 接口与资源

`server/rendering/renderer.ts` 导出 `NativeDrawioRenderer`，构造参数 `{assets?: RuntimeAssetPaths}`；`render(project, options?)`、`close()`。公共类型在 `server/rendering/types.ts`，B 已接入：

```ts
options = { background?: 'white'|'transparent', scale?: number,
            timeoutMs?: number, signal?: AbortSignal }
result = { png: Buffer, svg: string, width: number, height: number,
           scale: number, nativeXML: string, nativeSVG?: string,
           runtime: {drawioVersion, browserVersion, fontFamily, fontSha256},
           timings: {totalMs, browserStartMs, loadMs, exportMs}, warnings: string[] }
```

width/height 为实际 PNG 像素，scale 为实际导出比例；nativeXML 与可选 nativeSVG 是诊断对照，不替换不可变 source snapshot。`assets.ts` 提供 `resolveRuntimeAssets(projectRoot?)`、`checkRuntimeAssets()` 与根挂载的 `runtimeAssetsRouter()`：`/drawio/*`、`/runtime-assets/fonts/NotoSansCJKsc-Regular.otf`、字体许可。静态 vendor 复用现有安全 router，WAR 私有目录不对外开放。PM 已补开发模式同源字体代理。

默认只定位本项目 `resources/drawio/vendor`、`resources/fonts`、`resources/browsers/chromium_headless_shell-1234/...`；没有父目录/机器 Chrome 回退。固定 draw.io 31.5.3、playwright-core 1.62.1、headless Chromium 151.0.7922.34/revision1234。

## 可独立安装与诊断

```powershell
node scripts/setup-drawio-runtime.mjs
node --import tsx scripts/check-runtime-supply.mjs
```

setup 标准路径下载官方 `jgraph/drawio/releases/download/v31.5.3/draw.war`，SHA256 固定 `6c4ab25145c3479bf0097e4fccd20c602968615986bc999af8a214719fabd3f4`。使用 PM 固定依赖 fflate 0.8.2，应用层拒绝绝对路径、反斜杠/盘符/空字节、`.`/`..`、重复名称；上限 5000 entries、单 entry 64 MiB、展开总量 256 MiB。新 staging 内仅创建普通文件/目录，不恢复 ZIP 链接属性；安装后原子改名，不覆盖未验证现有 vendor。保留 Apache LICENSE、所有原包内部许可；字体附 OFL/COPYRIGHT/supply，浏览器由固定 Playwright installer 完整安装并保留其资源。第三方资源仍各依其随包许可，本记录不把所有资源概括为同一许可证。

本机实际命令（使用 PM 已核验 WAR，未重复下载54MB）：

```powershell
node scripts/setup-drawio-runtime.mjs --archive=output/playwright/runtime-supply/draw-v31.5.3.war --license=../resources/drawio/LICENSE --skip-browser
node scripts/setup-drawio-runtime.mjs --archive=output/playwright/runtime-supply/draw-v31.5.3.war
node scripts/setup-drawio-runtime.mjs --only-fonts --resources-root=output/playwright/runtime-font-clean-install
```

首次在项目内安装 3446 文件；随后完整 setup 幂等通过（包含固定 registry/browser install 命令）。诊断逐文件校验 manifest 字节/SHA，实际 launch 固定151通过。字体无缓存测试走标准官方 commit 下载，字体与 LICENSE hash 均匹配；LICENSE 路径是 commit 根 `/LICENSE`，不是不存在的 `/Sans/LICENSE`。draw.io 标准 raw LICENSE 下载地址也实际返回200且摘要匹配。二进制 vendor/cache/browser 已由 PM 忽略，不发布或提交二进制。

证据：`output/playwright/runtime-supply/project-runtime.json`、`setup.json`、官方原包核验 `drawio-official-archive.json`；无缓存字体及供应用料记录在 `output/playwright/runtime-font-clean-install/fonts/`。

## 统一字体

`src/drawing/engine/runtime-assets.ts` 为模板、业务库、Host 和 worker 提供同一 Noto Sans CJK SC Regular OTF 配置，官方 commit `523d033d6cb47f4a80c58a35753646f5c3608a78`，SHA256 `2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b`。font URL 带 SHA query 且 immutable cache；真实静态 Regular 声明400，标题 bold 由浏览器合成，没有假声明变量轴或交付完整粗体字库。

通过公开 `Editor.configure.fontCss` 注册本地字体，不改 vendor。新模板/库默认 Noto；defaultVertexStyle/defaultEdgeStyle 让普通原生库新增图形/连线也用 Noto，保留默认 orthogonal 路由及其他模板样式。固定151真实 Host 拖入 General 库普通装饰，实测 XML 含 Noto 和原有 whiteSpace，且没有业务绑定；font ready 与 bold 加载检查通过，原有 Host 编辑/隔离断言通过。

实际支持族：Noto Sans CJK SC，以及 Microsoft YaHei、Helvetica、Arial 到同一固定 Noto 字节的兼容映射。Host/worker 使用同一映射，源 XML/人工几何不改，返回 warnings 说明字体替代；不声称仍使用系统原字体。无显式字体的既有普通装饰按 native Helvetica 默认映射。未知手工字体（包括仅装饰、泛型 sans-serif 等未供应值）明确失败；未实现任意字体/emoji 供应。

## 后台原生流程与预算

renderer 自行启动仅127.0.0.1随机端口的专用宿主，无需用户浏览器页面、Runtime 或 DB。固定浏览器复用，每任务独立 BrowserContext/page；复用 Host controller 完成 configure→init→load/capture，宿主桥先验证精确 origin/source，Node 再处理公开协议。图片 export 使用独立唯一 token、精确 action/format 关联；未调用内部 graph，也未使用旧 renderScene/sharp 重绘。sharp 仅探针读取角点 alpha 验证白底/透明。

渲染前严格 validateDrawingProject；字体 load/ready 后公开 captureXML，要求业务 hash 与 `drawioRenderSignature` 均匹配 snapshot，否则失败。PNG 来自原生导出；SVG 来自原生矢量导出及下节确定性字体资源封装。外联请求被阻断并使任务失败；SVG 渲染依赖须全 data/# 内联，原生 FAQ 等安全可点击链接不是资源依赖。失败不返回旧图片。Abort/timeout 拒绝 pending 并销毁当前 context，后续新任务仍可成功；close 关闭共享 browser/server。

硬预算：scale 输入0.1–4；timeout1–60000ms，默认/最大60秒；最大边16384px、总3200万像素、最低实际比例0.01，无法满足则报错，不裁边。PNG≤32MiB、SVG≤96MiB、桥消息≤160MiB。超大图按完整 modelBounds 降比并返回实际值。renderer 的 maxJobs=2 仅防御上限，不承诺公开并行；B worker 实际串行1。

## SVG 字体单份封装与对照

原生开启 embedFonts 时混合别名会重复同一16MB字体：实测四族 SVG 87,770,061B、暖任务11.96秒，未达到8秒目标。原输出保留在 `output/playwright/drawio-renderer/font-duplicates-baseline/`。

经 PM 授权，当前公开 SVG export 使用 embedFonts=false，`svg-fonts.ts` 仅做资源封装：解析合法 presentation font-family、inline style、foreignObject HTML、style block；已供应等价族改 canonical Noto，删除对应 font-face 字体规则，defs 添加唯一一个同 SHA OTF data URI。未知族拒绝；不全字符串替换业务文字，不改 XML、文字、节点/边/边标签、几何、尺寸、paint 或其他 CSS。PNG 始终原生导出。

封装前后结构签名逐项保留文字、几何、paint/颜色、非字体 CSS；另以旧重复字体输出对照：原生未封装 SVG104,413B，封装后22,021,076B、唯一 font-face。字体 data 解码 SHA 与供应用料相同；旧/新原生 PNG 字节相同，旧/新离线 SVG 全图截图字节也相同，两份中文字体都 ready，零网络请求。证据 `svg-portability.json`、`mixed-aliases.native.svg`、`mixed-portable-before.png`、`mixed-portable-after.png`（已打开自检）。

## 实测与验证

```powershell
node --import tsx --test tests/drawio-renderer.test.ts tests/drawio-svg-fonts.test.ts tests/drawio-host.test.ts tests/drawio-engine.test.ts tests/drawio-project.test.ts tests/drawio-editing.test.ts
npx --no-install vue-tsc --noEmit
npx --no-install tsc -p tsconfig.server.json --noEmit
node --import tsx scripts/probes/drawio-host-browser.mjs
node --import tsx scripts/probes/drawio-renderer.mjs
node --import tsx scripts/probes/drawio-svg-portability.mjs
```

最终目标测试64/64，前后端类型检查通过。纯测试包含尺寸/像素/入参预算、资源缺失/坏字体、已供应别名/默认样式、SVG四处字体引用、未知字体、DTD、文字/几何/paint不变、单份字体SHA；原 Host/引擎测试全部保持。

固定151真实 renderer 最近全样本：标准 PBS23节点/26边原样，PNG1965×3029；160字标题/长节点/500字 note 样本1965×3899（已打开 PNG 自检）；白底/透明角点 alpha 实际255/0；4倍请求降至2.3168646955、4553×7018，完整范围仍在预算内。每样本 nativeXML hash/signature 与同一 snapshot 一致；没有为原 PBS 补边。密集执行阶段原有连线/标签交叠风险保留，未宣称全图无重叠。

单字体封装后的本代理标准 PBS 冷首次3.87秒，3次暖观测 P95=3.71秒、混合别名暖6.99秒。PM 随后独立重跑同一探针，当前 `report.json`（08:28:12Z）对应其独立结果：冷5.38秒、3暖4.67/4.17/3.97秒、观测P95=4.67秒、混合别名7.02秒。单独 portability 启新 renderer 的混合样本冷8.24秒。当前样本分别落在暖≤8秒/冷≤20秒目标内，但3次暖样本不构成生产 P95 保证。timings 不含 B 后续五制品发布/网络下载，详见原始 report，不以估算代替实测。

`report.json` 和 `failure-modes.json` 另真实复现：1ms及运行中300ms timeout、运行中AbortSignal、预中断、无供应字体、坏XML/DTD、缺browser、缺font；错误可定位。之后新标题快照可成功渲染，证明未返回旧图。独立 SVG 在阻断所有请求的页面加载字体通过。

产物均在 `output/playwright/drawio-renderer/`：PBS/long-text/transparent/large-scale/legacy/general/mixed PNG、SVG、drawio，`report.json`、`failure-modes.json`、`svg-portability.json`、`test.log`。Host 新字体复验在 `output/playwright/drawio-host/`。验收后暂停本代理 probe，供 PM 独立复测；D05 尚未开始。
