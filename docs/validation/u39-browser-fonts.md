# U39 浏览器中文字体按需供应

2026-11-02，开发自测冻结，待PM集成/验收。未提交、推送或部署，未请求生产资源/图形/账号；不把字体减重当作站点失联或OOM原因/恢复证明。

## 方案与实际退回

原浏览器把完整固定OTF加载到每个新引擎，原文件16,437,364字节，公网gzip约13.6MB/38秒。导出依赖该原始字体及SHA，本批不替换其供应或封装。

先试GB2312一级3755汉字+Latin/标点单common包，4269码点WOFF2仍1,352,832字节。按PM退回拆成产品UI常用核心、common256字、rare512字，避免欢迎页只有FlyMind就拉整common。核心256汉字取自产品UI源码的固定频次快照，非业务图或验收样本特化；另有Latin/标点，共770码点/1284glyph/137,316字节。冻结文本和SHA随供应留存。

**真实Host验证又发现固定draw.io的 `Editor.loadFonts/embedCssFonts` 会在保存/导出时逐一抓取config.fontCss的所有url，不遵守unicode-range按需意图。** 初版真实保存拉了全部95片+OTF，约29.5MB，已拒绝该接法，未将静态CSS测试当成功。

最终仅在同源DrawioHost独立head style注入分片CSS，configure和每次公开load前确保存在，主题更新、同槽复用及真正刷新都会重新/幂等应用。浏览器选项config.fontCss为空，不进入native的URL内联队列；不改vendor、模型、图形颜色/几何或业务fontFamily。每个face仍保留原OTF第二src回退，正常WOFF2浏览器不触发它。默认controller与runtimeFontCSS仍走原OTF，服务端renderer未开启browserFonts。

依据：[fontTools subset官方说明](https://fonttools.readthedocs.io/en/latest/subset/index.html)、[unicode-range按字符需求下载](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@font-face/unicode-range)、[OFL修改与分发FAQ](https://openfontlicense.org/ofl-faq/)。派生文件内名为FlyMind CJK Web，保留原copyright/license，原OFL全文不改，来源/工具版本/NOTICE保留。

## 固定供应与部署兼容

- 源OTF SHA仍 `2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b`。原OTF、OFL、父supply及runtimeFontCSS未改。
- 95个WOFF2：core1片、common14片、rare80片，合计13,093,180字节。**全量并非消失**，按所用文字分片请求；极多罕见字可接近全量，不承诺任意内容都很小。
- 全原cmap44,810码点精确、互斥、无丢失；每字advance和side-bearing与OTF相等，unitsPerEm相同；构建保留所有相关OpenType layout features及原UVS记录。原glyph65,535；分片总glyph66,450包含重复依赖闭包，未误把每片变成整字体。
- 固定manifest记录各片size/SHA/range/字数/glyph数及工具/core语料SHA；最终manifest SHA为 `2623cbb72f0481f4b32317ecd3a3b58c9ea5d26485a3cd5adfd6cb01e2033e0d`。发布前只修元数据换行：core与生成TS固定LF，core摘要统一为 `84e3e8a5cf1db706f1fa99b8d3eb75584cdbbb686befed934f5ad604bf5c713d`，95片字体逐文件SHA前后不变，未重生成。NOTICE/manifest原已LF，继续禁止Git文本转换。构建工具仅开发环境 `fonttools==4.60.1 / brotli==1.1.0`，生产不安装pip、不联网生成、不引入npm运行依赖。`scripts/build-browser-fonts.py`可离线重建。
- assets启动校验整份manifest和95片固定SHA；HTTP只允许固定文件名，返回font/woff2、immutable/nosniff；损坏/未知字节不作为字体返回。setup从包内资源复制/验证到独立缓存，含OTF fallback，不依赖浏览器请求时临时生成。
- package.files已有 `resources/fonts/`，`build-cloud-bundle.mjs`同样完整复制该目录；云包完整candidate逐文件冻结，新片成为明确的应用资源。compact按目标manifest携带新增文件，通用materializer不需改权限/协议，不能仅跑setup而让线上资源404回退大OTF。原raw font hash不变，但engineResourceKey按现有算法包含引擎/资源服务代码，正常会随本次代码变化，未伪装成旧兼容供应。

## 实际验证

```text
node --import tsx --test tests/browser-fonts.test.ts tests/drawio-loading.test.ts tests/drawio-host.test.ts
<隔离fontTools环境python> tests/browser-fonts-metrics.test.py
node --import tsx scripts/probes/browser-fonts.mjs
```

- Node **26/26**，含固定字节/覆盖、CSS/导出默认分离、HTTP篡改拒绝，以及setup实际安装到新临时资源cache后全部校验。Python1/1对全部44,810字重新核metrics，并对每片首/中/尾码点实际轮廓逐笔比较；不是只核advance。日志 `output/u39-font-tests.log`、`u39-font-metrics.log`。
- 实际固定隐藏浏览器/公开Host协议、无Playwright route、无生产资源，冷context分别跑小流程8节点、完整技术24节点/9组、PBS23节点。正确业务XML+字体ready+原生文字编辑入口验证；再同一引擎公开load，新增字体请求0。

| 场景 | 字体body字节 | 独立字体文件 | 冷ready | 同引擎warm ready |
|---|---:|---:|---:|---:|
| 小流程，原OTF | 16,437,364 | 1 | 1109ms | 31ms |
| 小流程，新分片 | 1,036,884 | 11 | 1049ms | 37ms |
| 完整技术24，新分片 | 1,286,828 | 13 | 1205ms | 76ms |
| PBS，新分片 | 1,449,848 | 15 | 1078ms | 81ms |

这是本机回环资源测量，冷ready含引擎初始化/fit/字体完成，非线上P95。body从Playwright请求sizes读取，cached重复项的负数实现值归0；独立文件数按路径去重。未把它当全部请求的协议开销或HTTP公网gzip字节。PBS多片总量略高于试验单common包，但小图更小、欢迎核心仅137KB；并保留少见字按需能力，没有继续为单样本重排字体。

- 流程真实双击输入 **“校验𠮷结果”** → public save/capture → normalizer内容核对 → 临时XML落盘 → 切技术24 → 读取已存XML公开load重开 → 再次双击验证文字可编辑。累计15个字体/1,434,288字节，无OTF、无95片全拉。文件保存/重开是此纯Host夹具，不冒充完整产品SQLite/CAS回归。
- 将该保存项目交给原NativeDrawioRenderer，真实PNG96,685字节、SVG约21.9MB。SVG包含同字，完整内嵌OTF解码SHA等于原固定值，未含web片URI；未改U35 renderer/svg-fonts。已实际看重开、技术图及导出PNG，中文/英文/罕字没有文字缺失。
- 输出：`output/playwright/u39-browser-fonts/{report.json,flowchart.png,technical.png,swimlane.png,edited-reopened.png,edited.drawio,edited-export.png,edited-export.svg}`。早期PBS测器尝试首个屏外task被边界hit区域挡住，改用U31既有可见业务文字定位；不改产品、不扩大timeout、不跳过该图。

字体首冷传输仍受带宽/请求开销影响；本机整体冷ready只改善少量，不能宣称全部图打开2秒SLA，更不能用字体改动解释此前MCP创建后主机/TLS失联。CPU隔离、主机事故证据及客户端API并行属于其它独立切片，最终由PM集成验收。
