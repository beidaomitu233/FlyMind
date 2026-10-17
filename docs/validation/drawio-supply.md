# D01-A draw.io 供应与固定版本协议核验

日期：2026-10-16。状态：指定核验范围已由项目经理验收通过，见 [验收台账](../DEVELOPMENT_TRACKER.md)。范围限于供应核验和独立协议探针，不代表 D02 或 D04 完成。

## 结论与复用范围

候选供应 `D:\AIBuilder\PM\resources\drawio\vendor` 可以在当前机器通过回环 HTTP、无外网请求、无头 Chrome 实际加载；本地运行时 `EditorUi.VERSION` 和 `app.min.js` 均为 **31.5.3**。本次保留此固定版本继续验证，没有升级理由或升级操作。

已实际通过 configure → init → load → 原生保存 → 原生移动后的 autosave → SVG/PNG/xmlsvg/xmlpng 导出。此次只有一个脱敏中文矩形，不覆盖 PBS、原生二维容器、元数据复制、字体跨机一致性或完整 worker。D02–D04 仍须逐项验证，不能用这份记录代替贯通验收。

## 来源、文件清单与哈希

初次核验时，历史 `../docs/references/SUPPLY_MANIFEST.md` 声称来源为 jgraph/drawio 官方 `draw.war`、版本 31.5.3；`vendor/META-INF/MANIFEST.MF` 只含 Manifest-Version/Class-Path，没有版本或来源认证，未找到原始归档。因此当时只核实本地标识。2026-10-16 项目经理后来下载官方固定 WAR、匹配 release SHA-256，并核对 vendor 全部 3446 文件无差异，已补齐该来源证据，见 [后台资源准备](drawio-runtime-supply.md#官方-drawio-归档补证)。未使用在线最新版协议替代本地能力验证。

只读遍历结果：供应根（含根 LICENSE）3447 个文件、155038647 bytes；其中 vendor 3446 个文件、155027291 bytes。目录内包含 64 个 WEB-INF 文件（5001826 bytes）及一个 META-INF 文件，含 Java 类/JAR 和集成配置名称；未读取或打印配置值。后续静态服务必须排除这两个目录和隐藏/越界路径，不能照搬整个 WAR 服务端面向公网。

完整逐文件相对路径、大小、SHA-256 见 `output/playwright/drawio-supply/inventory.json`，摘要及分目录统计见同目录 `summary.json`。排序采用路径字符串代码点顺序；清单摘要算法为 SHA-256，逐行 UTF-8 编码 `${sha256}  ${bytes}  ${path}\n`。清单摘要：

```text
8058e2e08598ba92c2d0b8191070dac8ee37c4df141c1eed62aefbba49c0cdc4
```

| 相对供应根路径 | bytes | SHA-256 |
|---|---:|---|
| LICENSE | 11356 | 43070e2d4e532684de521b885f385d0841030efa2b1a20bafb76133a5e1379c1 |
| vendor/index.html | 2759 | e1d2cc03e8f21296e14869e302c84781e8b4768615d6ef4260caa50e7fa26d59 |
| vendor/js/bootstrap.js | 11997 | e0ebe88fe83bdce09d5836306285891f2d6f259bf76677056a071bbba7cc0c9d |
| vendor/js/main.js | 447 | f2967ad73f4d8d20d8a910208a9ae8998d8c0dbaba90f5be049105b8496aa01d |
| vendor/js/app.min.js | 9772826 | af2cf82ab8c39c7c1b15c69cd9ffaa528cea0bb6e91f60460a01dbbf49be6f7e |
| vendor/styles/grapheditor.css | 75954 | b660bcd355fdb3257635c95c23445e24a49b54875805b662f63a15354bba4989 |

这些哈希是本机供应快照，不能证明上游归档真实性；未拿官方归档对比，所以完整性结论限于本地必需文件存在且本次加载/导出成功。

## 许可和分发边界

以下是现有文件内容的清点，尚未完成正式发行所需的全部第三方及原项目授权核查。所有六份 LICENSE 的哈希已经进入清单；未找到独立命名的 NOTICE 文件，不表示没有内嵌第三方声明。

| 文件 | 实际发现 | 后续边界 |
|---|---|---|
| resources/drawio/LICENSE | Apache License 2.0 正文 | 保留原许可证；不据此为整个 FlyMind 自动添加许可证。 |
| vendor/img/LICENSE、shapes/LICENSE、stencils/LICENSE | 图标/图库及衍生物用于 Atlassian 产品或其 marketplace/plugin 生态须有明确书面许可；条文另说明用户导出的图像/文档不受该项限制 | 不把图库概括为纯 Apache；正式发行按实际目标和选入资源核查并保留条款。 |
| vendor/templates/LICENSE | Creative Commons Attribution 4.0 正文 | 若分发模板资源，另核署名及许可通知；不将其与代码许可混同。 |
| vendor/js/libavoid-js/LICENSE | GNU LGPL 2.1 正文 | 源码、构建及分发要求待正式审查；本次没有验证/启用它的路由 API。 |

原 draw.war 原件、对应源码/第三方声明、原 FlyMind 项目的正式分发授权仍待补证。上述缺口不妨碍本机只读技术验证，但不能据本报告宣称正式分发已合规。

## 字体和浏览器供应

vendor 共 34 个字体文件、437420 bytes：ArchitectsDaughter-Regular.ttf 一个及 MathJax WOFF2 33 个；没有发现通用中文字体包。`export-fonts.css` 仅一行注释，没有声明本地导出字体。未在此供应里发现上述字体的独立 OFL/许可证文件，不能假设其分发授权已经核清。

本机存在 `C:\Windows\Fonts\msyh.ttc`、msyhbd.ttc、msyhl.ttc。本探针使用系统 Microsoft YaHei，截图及 PNG 中文可读，等待 `document.fonts.ready` 后状态 loaded，`document.fonts.check('16px "Microsoft YaHei"')` 为 true。该检查及截图只证明当前机器可用，不是字体授权证据或完整字形覆盖证明。msyh.ttc SHA-256：`d79c55e68b1131eea0cc1c47be4f572d964f28c682e143db2ad09c1e4cb07a3f`。没有复制或打包系统字体。D04 需要另选可分发中文字体并保留许可，随后用同一字体复测前后台换行。

| 项目 | 本次实际基线 |
|---|---|
| Node | v20.19.6，C:\nvm4w\nodejs\node.exe |
| OS/架构 | Windows 内核 10.0.26200、x64；注册表 DisplayVersion 25H2、UBR 9711（ProductName 仍报告 Windows 10 Pro，保留原值，不据此猜测商品名称） |
| CPU/内存 | AMD Ryzen 5 7500F 6-Core Processor、12 逻辑处理器、16767688704 bytes 物理内存（Node os 接口） |
| 实测浏览器 | Chrome 155.0.8059.80，C:\Program Files\Google\Chrome\Application\chrome.exe，headless=true |
| 另有浏览器 | Edge 155.0.4283.60，C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe；仅查文件版本，未运行该探针 |
| 自动化运行库 | 宿主已提供 Playwright 1.62.1，未加入 package.json/lock，未安装依赖 |

当前 Chrome/Edge 属于机器已有安装，并非应用锁定供应；未发现 `%LOCALAPPDATA%\ms-playwright` 浏览器缓存。D04 尚需确定可固定、可重现、可分发的 Chromium 供应，当前成功运行不能视作已完成该工作。硬件通过 Node os 接口记录；CIM 查询被当前环境拒绝，未据此伪造机器型号。

## 本地协议实测

探针 `scripts/probes/drawio-protocol.mjs` 建立 `127.0.0.1` 随机空闲端口，直接读取现有 vendor，不复制资源，不占用既有服务；拒绝 WEB-INF/META-INF、隐藏目录和越界路径。使用全新浏览器上下文、阻止 service worker，拦截所有非本机 origin 请求。宿主收包同时检查精确 source 和 origin，发送使用精确 targetOrigin。结束时关闭页面/浏览器和自己的服务。

页面实际参数：`embed=1&proto=json&configure=1&offline=1&local=1&lang=en&saveAndExit=0&noSaveBtn=0&noExitBtn=1`。这些参数仅作为本次组合证据，不逐一声称每个参数单独生效。使用现有 Playwright 做协议/原生按键探针，没有创建 Playwright test 规格或通过内部模型 API制造事件。

| 动作/事件 | 实际结果 |
|---|---|
| configure | 收到 configure 后发送 action=configure，再收到 init。 |
| load | 发送中文矩形 XML、title、autosave=1；收到 event=load，画布文字可见，运行时版本 31.5.3。load 回包不包含请求 message，不将其用作任意请求关联。 |
| save | 原生画布获得焦点，Control+s；收到 event=save、614 字符 XML，中文标签保留；保存到 saved.drawio。初始 Save 按钮隐藏，首次按钮点击超时，改用原生快捷键后通过。 |
| autosave | 选中该矩形、ArrowRight 移动；收到 autosave、614 字符 XML；与保存文档不同且中文标签保留。 |
| export SVG | 实际返回 data:image/svg+xml;base64，2730 字符 data URL。 |
| export PNG | 实际返回 data:image/png;base64，3114 字符 data URL；PNG 为 182×62，人工查看中文可读。 |
| export xmlsvg | 实际返回 SVG data URL、3466 字符；回包 format 是 svg，原请求仍为 xmlsvg。 |
| export xmlpng | 实际返回 PNG data URL、4686 字符；回包 format 为 xmlpng。 |
| 关联字段 | export 回包 event.message 是完整原请求对象，原请求自定义字符串位于 event.message.message；四种导出均已断言该值。 |
| 外联/异常 | 外网请求 0、页面异常 0、失败浏览器请求 0；本地 `/drawio/null` 返回一次 404，不影响上述链路。原因未定位，后续宿主接入时保留该诊断，不称所有请求完美。 |

本次 xmlsvg/xmlpng 验证了格式响应及较大制品，尚未验证将嵌入元数据重新导入的往返等价。PNG/SVG 是导出原始保存快照，与随后移动后的 autosave 分开，不将两个修订混合。

证据目录：`output/playwright/drawio-supply/`（忽略输出）。包含 `protocol.json`（事件结构、浏览器版本、请求诊断）、`editor-loaded.png`、`saved.drawio`、`export-svg.svg`、`export-png.png`、`export-xmlsvg.svg`、`export-xmlpng.png`、`inventory.json`、`summary.json`。

## 复现命令和状态

从 `D:\AIBuilder\PM\flyMind` 执行：

```powershell
node scripts/check-drawio-supply.mjs
$env:DRAWIO_PROBE_PLAYWRIGHT='C:\Users\12062\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright\index.mjs'
$env:DRAWIO_PROBE_BROWSER='C:\Program Files\Google\Chrome\Application\chrome.exe'
node scripts/probes/drawio-protocol.mjs
node --check scripts/check-drawio-supply.mjs
node --check scripts/probes/drawio-protocol.mjs
git diff --check -- scripts/check-drawio-supply.mjs scripts/probes/drawio-protocol.mjs docs/validation/drawio-supply.md
```

实际资源清点、探针最终运行均退出 0。初次沙箱浏览器访问回环被 `net::ERR_NETWORK_ACCESS_DENIED` 拒绝；在自动审核允许的外层环境重跑后成功。复现环境若有同样的网络隔离，需要允许浏览器访问该探针自己的回环端口；探针不会放行外部网站。未运行 npm install/升级，没有改版本或提交。应用完整 npm test/build 由主代理另行验收，本子任务未重复执行。

请求验收：核对供应清单可重现、当前版本基础协议及本机离线导出证据。未决项：官方归档真实性/第三方完整声明、可分发中文字体、固定 Chromium 供应、`/drawio/null` 成因，以及后续二维容器/元数据/真实 PBS 质量与 worker 一致性验证。
