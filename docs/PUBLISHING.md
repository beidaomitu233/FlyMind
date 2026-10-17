# FlyMind 公开分发维护流程

状态：本轮按用户决定**已发布 GitHub Release**，npm 与 MCP Registry 延期。下载标签 `mcp-v1.0.0`，不移动原 `v1.0.0`；应用/package 版本仍为 `1.0.0`。npm 包名 `flymind-drawing-studio`、Registry 名 `io.github.beidaomitu233/flymind` 保留，官方 Registry validate 已通过，但未执行 npm/Registry publish。四项制品的远端摘要和匿名ZIP下载已核对。

## 本轮 GitHub 制品

发布入口：https://github.com/beidaomitu233/FlyMind/releases/tag/mcp-v1.0.0

- `flymind-drawing-studio-1.0.0.tgz`：已构建 CLI/Web 的安装包。
- `FlyMind-MCP-1.0.0-Windows.zip`：包含上述 tgz、根 README/LICENSE/THIRD_PARTY_NOTICES，以及 `docs/INSTALL_AND_USE.md`、`docs/CODEX_SETUP.md`，保持相对路径结构。
- 附制品 SHA256，下载 ZIP 解压后从安装文档开始；它不是自包含离线资源安装器。

PM 上传实际验收的制品并核对公开下载；不得把 GitHub tag 当作 npm 已发布。不重启、不迁移当前用户服务。

已完成：Windows Node20.19.6/npm10.8.2 独立临时目录 `--omit=dev` 安装168包约48秒，真实网络 setup/doctor 通过；309项回归、4项CLI定向与build通过。五类SDK最终结果由PM补充。

以下 npm/Registry 步骤供**后续重新授权发布时**使用，本轮不执行。

## 1. 分发形态与接口

- 用户主入口只有 [安装与使用](INSTALL_AND_USE.md)，README 链接该文档。源码开发安装保留在 README，不让普通用户先 clone/build/配 pilot。
- A 负责 npm 构建与 CLI：预编译 `lib/server`、`lib/src`、网页 `dist`，`bin/flymind.mjs`；安装运行不依赖 devDependency `tsx`。
- `flymind` / `flymind mcp`：默认原生 STDIO；`setup`：固定资源；`doctor`：只读检查关键资源、固定 draw.io 版本与字体 SHA256（非完整供应校验）；`studio`：启动/复用同根 Runtime 并打开实际网页。
- 默认数据/凭据/资源在当前用户目录，端口 0 动态分配；不写 npm/npx 安装缓存，不自动迁移原用户库。必须先显式 setup，再 doctor，最后注册 MCP；缺资源快速报 RUNTIME_SETUP_REQUIRED，不在握手前自动下载。setup 进度和子进程 stdout 必须转 stderr，MCP stdout 仅协议。
- MCP Registry 只发布元数据，npm 才承载安装制品。插件 manifest 是仓库本地接入材料，不表示获得任何插件商店上架。

## 2. 许可与供应门槛

用户已于本批选择主项目 MIT；根 [LICENSE](../LICENSE) 为 `Copyright (c) 2026 beidaomitu233`。package 的 SPDX `license` 由 A 同步为 `MIT`。该许可**不替代第三方许可**；随包摘要见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)：

| 组件 | 本地核实许可 | 分发检查 |
|---|---|---|
| 固定 draw.io 31.5.3 | Apache-2.0 | 保留 resources/drawio/LICENSE、供应清单及 vendor 自带第三方声明，不删归属 |
| Noto Sans CJK SC | SIL OFL-1.1 | 保留 OFL.txt、COPYRIGHT.txt、字体元数据及固定 SHA；不改名伪装自有字体 |
| Chromium headless shell | Chromium 与捆绑组件各自条款 | 固定供应下载保留自身 LICENSE/NOTICE 等，不以主 MIT 覆盖 |
| playwright-core、sharp | Apache-2.0 | 保留其包内许可；sharp 所用 native/libvips 等传递依赖另有自身许可 |
| elkjs | EPL-2.0 | 不错误声明全依赖均 MIT；包内许可保留 |
| MCP SDK、xmldom、better-sqlite3、cors、express、fflate、pinia、vue、vue-router、zod | 当前本地直接依赖声明为 MIT | 原生绑定及传递依赖还须检查，不能只扫描顶层就称全部合规 |

draw.io WAR/浏览器不塞进 npm 大包，首次下载仍需准确来源、SHA、版本、许可。字体若进入 npm tarball，必须随带字体许可与归属。发布白名单要包含必要运行标准/guide、供应清单及许可证；排除用户数据、导出原文、备份、测试输出、截图、凭据和个人路径。

此表是本地文件盘点，不替代权利核实；上游原应用/历史引入内容的授权由维护者确认，不能因新添 MIT 就消除他人权利。

## 3. 发布前只打包，不上架

由 A/PM 运行并保留输出，本文件作者未代执行：

```powershell
npm ci
npm test
npm run build
npm pack --dry-run --json
npm pack
```

核对 tarball 白名单：

- bin 实际存在且有 shebang；Windows shim 与 `node <绝对bin> mcp` 均可启动；无错误 TS/tsx 运行入口。
- `lib`、`dist` 与运行必读文档齐全；第三方许可和固定供应声明齐全。
- 不含 data、SQLite/WAL/SHM、原业务文件、artifacts、备份、output、node_modules、自有浏览器进程目录、Registry/npm token 或 `.env`。
- `package.name/version/mcpName` 与 `server.json` npm identifier/version/name 一致，`private` 已在确认公开分发后移除。

在独立安装前缀/用户根做 tgz 安装，不能用仓库已有 node_modules、源码或资源替它兜底。验证 Node native 依赖、setup/doctor、默认持久目录、STDIO tools/list、真实一图 PNG+五文件、网页编辑保存及无页面导出。Windows 控制台静默与正常退出也要实际看，不能只 assert `headless:true`。记录精确 Node/npm/OS 和安装包 SHA，未测平台不宣称支持。

包依赖和资源首次下载都可能联网，`.tgz` 安装不是“完全离线安装”。资源路径覆盖应明确，测试不能写入用户现有工作区。

## 4. npm 账号与人工发布

先确认账号和该包名权限，不打印 token：

```powershell
npm login
npm whoami
npm view flymind-drawing-studio versions --json
```

公开发布需满足 npm 当前认证/2FA 或受支持的自动化授权要求。包名/版本一旦发布不能再次用相同组合覆盖，Git 标签不代表 npm 已存在。[npm publish 官方说明](https://docs.npmjs.com/cli/v11/commands/npm-publish/)与[package.json 规范](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/)为准。

PM 最后核定 tarball、账号、版本和文档状态后，才执行授权的实际发布：

```powershell
npm publish --access public
npm view flymind-drawing-studio@1.0.0 version dist.integrity mcpName bin --json
```

scoped 包若后续采用 `@账号/包名`，也需对应账号权限与 public access。后续可设计手动 workflow_dispatch、环境人工审批与可信发布；本批不添加 push/tag 自动发布流程，不把长期 token 写入仓库。

## 5. MCP Registry 身份与 server.json

已采用官方固定 schema `https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`。仓库 [server.json](../server.json) 只是待发布元数据，不能当成已上架证明。

- name = `io.github.beidaomitu233/flymind`；必须与 npm tarball 内 package.json `mcpName` 完全一致。
- GitHub 认证账号须能控制 `beidaomitu233` 命名空间，repo URL 不单独证明认证成功。
- packages[0]：registryType npm、identifier `flymind-drawing-studio`、具体 version `1.0.0`、runtimeHint npx、stdio，显式 package argument `mcp`。不是 HTTP remote，不把动态 Runtime URL 填入 remotes。
- 用户默认目录不要求 API Key 或必填 env；自定义目录通过 CLI 环境覆盖，不把维护者本机路径写进清单。

按照 [官方 Registry quickstart](https://modelcontextprotocol.io/registry/quickstart) 获取并核实 `mcp-publisher`，先查看其当前 `--help`；现有 server.json 不要用 init 覆盖。npm 包确实可读取后，PM 执行交互 GitHub device 登录与发布：

```powershell
mcp-publisher validate
mcp-publisher login github
mcp-publisher publish
```

PM 已实际使用官方 mcp-publisher v1.8.1 对本仓库 server.json 执行 validate，返回 valid，证据位于 output/npm-release/tools；这仅验证候选元数据，不代表已经发布。

不要把 device code/token、publisher 本机认证文件或 npm 凭据打包。官方 Registry 仍处预览，schema/API 如变动应按当次官方文档核对，不伪造发布成功。

发布后核对实际发现结果：

```powershell
Invoke-RestMethod 'https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.beidaomitu233/flymind'
```

检查 name/version/npm package/transport，而不只是搜索到相似名称。Registry 发现不等于所有 MCP 客户端自动安装，也不表示插件目录审核通过。

## 6. 发布后文档收口

后续 npm/Registry 发布时，只有 npm view、Registry 查询与干净安装真实通过，PM 才增加在线安装入口，附确认日期/版本；GitHub 下载入口可独立发布。保留源码入口区别、未完成阶段、仅验证平台和首次联网说明；不为了宣传把 D07/D08/G2 写为全部通过。

推荐单一推广链接：`docs/INSTALL_AND_USE.md`，说明五类用途、自然语言用例、编辑/修改/导出、目录/卸载保数据即可。发布不会自动迁移、重启或清理正在运行的用户服务。
