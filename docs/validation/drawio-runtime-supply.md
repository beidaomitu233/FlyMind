# 后台运行资源准备

日期：2026-10-16。项目经理完成的供应准备与独立诊断；**D04 worker 正在实现验收，不代表 D04 或无页面导出已通过**。

## 固定浏览器

- 项目依赖 `playwright-core` 固定为 `1.62.1`，package-lock 保留 registry 包完整性值；应用版本仍为 0.6.0。使用 Node 20.19.6。
- 按该包 `browsers.json` 安装 Chromium headless shell revision `1234`，浏览器版本 `151.0.7922.34`；不是随机器升级的 Chrome 155。
- 位置 `resources/browsers/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe`；该运行目录已忽略，不将二进制及用户浏览器数据提交仓库。
- 安装命令：先设 `PLAYWRIGHT_BROWSERS_PATH` 为项目绝对 `resources/browsers`，再执行 `node node_modules/playwright-core/cli.js install chromium --only-shell`。保留自动下载的许可证和辅助文件。
- 初次部分 CDN 连接发生 TLS ECONNRESET，安装器重试后退出 0；不能称网络始终无错误。项目经理随后实际 headless launch、建立新页面、验证中文标题并关闭浏览器，版本为 151.0.7922.34。
- headless exe SHA-256：`ce4635cd0e5dc0e21494542a701f347e91c1f1d821970578d97ed8df4ced50ef`。证据 `output/playwright/runtime-supply/browser.json`。

[Playwright 官方浏览器说明](https://playwright.dev/docs/browsers)说明浏览器与包版本配套，`--only-shell` 可仅安装 headless shell。后续安装/诊断脚本必须检查该固定配套，不以机器 Chrome 静默替代缺失供应。

## 中文字体

- 使用官方 Noto Sans CJK SC Regular 2.004，固定发布标签 `Sans2.004` 解析的提交 `523d033d6cb47f4a80c58a35753646f5c3608a78`。
- 文件 `resources/fonts/NotoSansCJKsc-Regular.otf`，16,437,364 字节；SHA-256 `2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b`。
- 同目录 `supply.json` 保存来源/提交/摘要；`OFL.txt` 保存原始 SIL OFL 1.1 许可证；`COPYRIGHT.txt` 提取并保存字体内部版权声明，不修改字体。
- 项目经理实际检查 OTTO 签名、字体/许可证摘要，解析 name 表确认 family 为 Noto Sans CJK SC、Regular、Version 2.004；证据 `output/playwright/runtime-supply/font.json`。

来源：[官方固定发布](https://github.com/notofonts/noto-cjk/releases/tag/Sans2.004)、[固定提交字体](https://github.com/notofonts/noto-cjk/blob/523d033d6cb47f4a80c58a35753646f5c3608a78/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf)、[原始许可证](https://github.com/notofonts/noto-cjk/blob/523d033d6cb47f4a80c58a35753646f5c3608a78/LICENSE)。后续保持版权与许可，未对字体做子集化或改名。

## 官方 draw.io 归档补证

项目经理通过 [官方 31.5.3 发行页](https://github.com/jgraph/drawio/releases/tag/v31.5.3) 对应的 GitHub release API 查询到 `draw.war`，大小 53,984,458 字节，官方 SHA-256 为 `6c4ab25145c3479bf0097e4fccd20c602968615986bc999af8a214719fabd3f4`。实际下载至忽略的 `output/playwright/runtime-supply/draw-v31.5.3.war`，在网络 EOF/超时后通过断点续传完成，最终大小和摘要均匹配；未将部分文件作为有效资源使用。

随后逐项读取该 ZIP/WAR 的文件流并计算摘要，与既有 `../resources/drawio/vendor` 全部 **3446** 个文件比较：缺失 0、多余 0、哈希差异 0。证据 `output/playwright/runtime-supply/drawio-official-archive.json`，核验时间 2026-10-16T07:56:40Z。D01 原“官方归档真实性未核实”这一项已补证；供应报告其余第三方/正式分发边界不因此自动清零。

D04 安装脚本需从固定官方归档/摘要建立本项目 `resources/drawio/vendor`，不能把依赖上级 PM 目录作为独立仓库的正式安装方式。该二进制目录与缓存已忽略，字体许可证及供应说明保留。

## 后续接入验证

历史 A2 初始证据使用系统 Microsoft YaHei，D04 正在将 Host/模板与 worker 统一到上述固定 Noto 文件。需要验证字形就绪、原生导出、SVG 可移植性和换行一致，不能仅凭空白页面 launch 认为复杂 PBS 或后台任务已经通过。

项目经理独立运行 `npm.cmd run check:runtime` 成功，诊断时间 `2026-10-16T08:25:32.041Z`：本项目资源目录中 **3446** 个 vendor 文件全部通过清单摘要验证，字体/许可证检查通过，实际启动并关闭固定 Chromium `151.0.7922.34`。证据 `output/playwright/runtime-supply/project-runtime.json`。此命令不访问业务数据库；只验证供应，不代替任务或图像验收。
